import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Git utility functions
//
// All functions accept a `cwd` parameter (the repo root) and use execSync
// for simplicity. Errors are thrown to the caller.
// ---------------------------------------------------------------------------

function exec(command: string, cwd: string): string {
  return execSync(command, { cwd, encoding: 'utf-8', timeout: 30_000 }).trim();
}

/**
 * Temporarily rewrites the remote URL to embed Bitbucket credentials, runs
 * `action`, then restores the original URL via `finally`. Falls back to
 * running `action` directly when credentials are absent or the remote URL
 * does not match BITBUCKET_BASE_URL (e.g. SSH remotes).
 */
function withAuthedRemote(
  remote: string,
  cwd: string,
  action: () => void
): void {
  const username = process.env.BITBUCKET_USERNAME;
  const token = process.env.BITBUCKET_TOKEN;
  const baseUrl = process.env.BITBUCKET_BASE_URL;

  if (username && token && baseUrl) {
    let host: string;
    try {
      host = new URL(baseUrl).host;
    } catch {
      logger.info(
        'BITBUCKET_BASE_URL is malformed, skipping credential injection.'
      );
      action();
      return;
    }

    const currentRemote = exec(`git remote get-url ${remote}`, cwd);
    const authedUrl = currentRemote.replace(
      `https://${host}`,
      `https://${encodeURIComponent(username)}:${encodeURIComponent(token)}@${host}`
    );

    if (authedUrl === currentRemote) {
      logger.info(
        'Remote URL does not match BITBUCKET_BASE_URL host, skipping credential injection.'
      );
      action();
      return;
    }

    exec(`git remote set-url ${remote} ${authedUrl}`, cwd);
    try {
      action();
    } finally {
      exec(`git remote set-url ${remote} ${currentRemote}`, cwd);
    }
  } else {
    action();
  }
}

export function getRepoRoot(): string {
  const workspace = process.env.WORKSPACE;
  if (workspace && existsSync(join(workspace, '.git'))) {
    return workspace;
  }

  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }

  throw new Error('Cannot find git repository root.');
}

export function getCurrentBranch(cwd: string): string {
  return exec('git rev-parse --abbrev-ref HEAD', cwd);
}

export function gitFetch(remote: string, cwd: string, branch?: string): void {
  const fetchTarget = branch ? `${remote} ${branch}` : remote;
  logger.info(`Fetching ${fetchTarget}...`);
  withAuthedRemote(remote, cwd, () => exec(`git fetch ${fetchTarget}`, cwd));
}

export function gitCheckout(branch: string, cwd: string): void {
  logger.info(`Checking out ${branch}...`);
  exec(`git checkout ${branch}`, cwd);
}

export function gitCreateBranch(
  branchName: string,
  fromBranch: string,
  cwd: string
): void {
  logger.info(`Creating branch ${branchName} from ${fromBranch}...`);
  exec(`git checkout ${fromBranch}`, cwd);
  exec(`git checkout -b ${branchName}`, cwd);
}

export function gitAdd(files: string[], cwd: string): void {
  for (const file of files) {
    exec(`git add "${file}"`, cwd);
  }
}

export function gitCommit(
  message: string,
  cwd: string,
  noVerify = false
): void {
  logger.info('Committing...');
  const flag = noVerify ? ' --no-verify' : '';
  exec(`git commit -m "${message}"${flag}`, cwd);
}

export function gitAmend(cwd: string): void {
  logger.info('Amending commit...');
  exec('git commit --amend --no-edit --no-verify', cwd);
}

export function gitPush(
  branch: string,
  cwd: string,
  force = false,
  noVerify = false
): void {
  const forceFlag = force ? ' --force-with-lease' : '';
  const noVerifyFlag = noVerify ? ' --no-verify' : '';
  logger.info(`Pushing ${branch}${force ? ' (force-with-lease)' : ''}...`);
  withAuthedRemote('origin', cwd, () =>
    exec(`git push -u origin ${branch}${forceFlag}${noVerifyFlag}`, cwd)
  );
}

/**
 * Returns true if a branch exists on the remote (origin).
 */
export function remoteBranchExists(branch: string, cwd: string): boolean {
  try {
    const result = exec(`git ls-remote --heads origin ${branch}`, cwd);
    return result.length > 0;
  } catch {
    return false;
  }
}
