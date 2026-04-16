import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Jira REST utility for creating test tickets
// ---------------------------------------------------------------------------

function getJiraAuth(): {
  baseUrl: string;
  headers: Record<string, string>;
} | null {
  const token = process.env.JIRA_API_TOKEN ?? process.env.JIRA;
  const email = process.env.JIRA_EMAIL ?? process.env.BITBUCKET_USERNAME;
  const baseUrl = process.env.JIRA_BASE_URL ?? 'https://juspay.atlassian.net';

  if (!token || !email) {
    logger.warn(
      'JIRA_API_TOKEN/JIRA and JIRA_EMAIL not set. Cannot create Jira ticket.'
    );
    return null;
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return {
    baseUrl,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
  };
}

/**
 * Extract a Jira ticket key from a branch name.
 * e.g., "BZ-1234-add-settings" -> "BZ-1234"
 *       "feature/BZ-567-foo"   -> "BZ-567"
 */
export function extractTicketKey(branchName: string): string | undefined {
  const match = /([A-Z]+-\d+)/i.exec(branchName);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Create a Jira task ticket for test generation work.
 *
 * Returns the ticket key and ID, or null if creation fails.
 */
export async function createTestTicket(
  projectKey: string,
  summary: string,
  description: string,
  parentTicketKey?: string
): Promise<{ key: string; id: string } | null> {
  const creds = getJiraAuth();
  if (!creds) return null;

  const url = `${creds.baseUrl}/rest/api/3/issue`;

  const body: Record<string, unknown> = {
    fields: {
      project: { key: projectKey },
      summary,
      issuetype: { name: 'Task' },
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description }],
          },
        ],
      },
    },
  };

  // Link to parent ticket if available
  if (parentTicketKey) {
    (body.fields as Record<string, unknown>).labels = [
      'lumos-generated',
      'e2e-tests',
    ];
  }

  try {
    logger.info(`Creating Jira ticket: "${summary}" in ${projectKey}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: creds.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.warn(
        `Failed to create Jira ticket: ${response.status} ${response.statusText} ${errorText}`
      );
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const key = typeof data.key === 'string' ? data.key : '';
    const id = typeof data.id === 'string' ? data.id : '';

    logger.info(`Jira ticket created: ${key}`);

    // Link to parent ticket if we have both keys
    if (parentTicketKey && key) {
      await linkTickets(creds, key, parentTicketKey);
    }

    return { key, id };
  } catch (err) {
    logger.warn(`Error creating Jira ticket: ${err}`);
    return null;
  }
}

async function linkTickets(
  creds: { baseUrl: string; headers: Record<string, string> },
  fromKey: string,
  toKey: string
): Promise<void> {
  const url = `${creds.baseUrl}/rest/api/3/issueLink`;
  const body = {
    type: { name: 'Relates' },
    inwardIssue: { key: fromKey },
    outwardIssue: { key: toKey },
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: creds.headers,
      body: JSON.stringify(body),
    });
    logger.info(`Linked ${fromKey} -> ${toKey}`);
  } catch {
    logger.warn(`Failed to link ${fromKey} -> ${toKey} (non-fatal)`);
  }
}
