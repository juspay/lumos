import { logger } from './logger.js';
import type { PrMetadata, ChangedFile } from '../parsers/types.js';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

export function getBitbucketAuth(): {
  baseUrl: string;
  headers: Record<string, string>;
} | null {
  const baseUrl =
    process.env.BITBUCKET_BASE_URL ?? 'https://bitbucket.juspay.net';
  const username = process.env.BITBUCKET_USERNAME;
  const token = process.env.BITBUCKET_TOKEN;

  if (!username || !token) {
    logger.warn(
      'BITBUCKET_USERNAME or BITBUCKET_TOKEN not set. Bitbucket REST calls will fail.'
    );
    return null;
  }

  const auth = Buffer.from(`${username}:${token}`).toString('base64');
  return {
    baseUrl,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Fetch PR metadata (title, description, source/target branches)
// ---------------------------------------------------------------------------

export async function fetchPrMetadata(
  workspace: string,
  repository: string,
  pullRequestId: string
): Promise<PrMetadata | null> {
  const creds = getBitbucketAuth();
  if (!creds) return null;

  const url =
    `${creds.baseUrl}/rest/api/latest/projects/${workspace}` +
    `/repos/${repository}/pull-requests/${pullRequestId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: creds.headers,
    });

    if (!response.ok) {
      logger.warn(
        `Failed to fetch PR metadata: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const fromRef = data.fromRef as Record<string, unknown> | undefined;
    const toRef = data.toRef as Record<string, unknown> | undefined;

    const changedFiles = await fetchPrChangedFiles(
      workspace,
      repository,
      pullRequestId
    );

    return {
      id: typeof data.id === 'number' ? data.id : Number(pullRequestId),
      title: typeof data.title === 'string' ? data.title : '',
      description: typeof data.description === 'string' ? data.description : '',
      sourceBranch:
        typeof fromRef?.displayId === 'string'
          ? (fromRef.displayId as string)
          : '',
      targetBranch:
        typeof toRef?.displayId === 'string' ? (toRef.displayId as string) : '',
      changedFiles,
    };
  } catch (err) {
    logger.warn(`Error fetching PR metadata: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch changed files for a PR
// ---------------------------------------------------------------------------

export async function fetchPrChangedFiles(
  workspace: string,
  repository: string,
  pullRequestId: string
): Promise<ChangedFile[]> {
  const creds = getBitbucketAuth();
  if (!creds) return [];

  const url =
    `${creds.baseUrl}/rest/api/latest/projects/${workspace}` +
    `/repos/${repository}/pull-requests/${pullRequestId}/changes?limit=500`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: creds.headers,
    });

    if (!response.ok) {
      logger.warn(
        `Failed to fetch PR changes: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const data = (await response.json()) as Record<string, unknown>;
    const values = Array.isArray(data.values) ? data.values : [];

    const files: ChangedFile[] = [];
    for (const entry of values) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const pathObj = record.path as Record<string, unknown> | undefined;
      // Bitbucket DC returns path.toString as a string with the full path.
      // Fall back to path.name (just the filename) if toString is missing.
      const rawToString = (pathObj as Record<string, unknown>)?.toString;
      const filePath =
        typeof rawToString === 'string'
          ? rawToString
          : typeof pathObj?.name === 'string'
            ? (pathObj.name as string)
            : undefined;

      if (!filePath) continue;

      const changeType = (
        typeof record.type === 'string' ? record.type : 'MODIFY'
      ) as ChangedFile['changeType'];

      files.push({ path: filePath, changeType });
    }

    return files;
  } catch (err) {
    logger.warn(`Error fetching PR changed files: ${err}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Create a pull request in Bitbucket
// ---------------------------------------------------------------------------

export async function createBitbucketPr(
  workspace: string,
  repository: string,
  title: string,
  sourceBranch: string,
  targetBranch: string,
  description: string
): Promise<{ id: number; url: string } | null> {
  const creds = getBitbucketAuth();
  if (!creds) return null;

  const url =
    `${creds.baseUrl}/rest/api/latest/projects/${workspace}` +
    `/repos/${repository}/pull-requests`;

  const body = {
    title,
    description,
    fromRef: {
      id: `refs/heads/${sourceBranch}`,
      repository: {
        slug: repository,
        project: { key: workspace },
      },
    },
    toRef: {
      id: `refs/heads/${targetBranch}`,
      repository: {
        slug: repository,
        project: { key: workspace },
      },
    },
  };

  try {
    logger.info(`Creating PR: "${title}" (${sourceBranch} -> ${targetBranch})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: creds.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.warn(
        `Failed to create PR: ${response.status} ${response.statusText} ${errorText}`
      );
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const prId = typeof data.id === 'number' ? data.id : 0;
    const links = data.links as Record<string, unknown> | undefined;
    const selfLinks = Array.isArray((links?.self as unknown[]) ?? [])
      ? (links?.self as Array<Record<string, unknown>>)
      : [];
    const prUrl =
      selfLinks.length > 0 && typeof selfLinks[0].href === 'string'
        ? (selfLinks[0].href as string)
        : `${creds.baseUrl}/projects/${workspace}/repos/${repository}/pull-requests/${prId}`;

    logger.info(`PR #${prId} created: ${prUrl}`);
    return { id: prId, url: prUrl };
  } catch (err) {
    logger.warn(`Error creating PR: ${err}`);
    return null;
  }
}
