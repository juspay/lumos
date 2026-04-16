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

export function gitFetch(remote: string, cwd: string): void {
  logger.info(`Fetching ${remote}...`);
  exec(`git fetch ${remote}`, cwd);
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

export function gitCommit(message: string, cwd: string): void {
  logger.info('Committing...');
  exec(`git commit -m "${message}"`, cwd);
}

export function gitAmend(cwd: string): void {
  logger.info('Amending commit...');
  exec('git commit --amend --no-edit', cwd);
}

export function gitPush(branch: string, cwd: string, force = false): void {
  const forceFlag = force ? ' --force-with-lease' : '';
  logger.info(`Pushing ${branch}${force ? ' (force-with-lease)' : ''}...`);
  exec(`git push -u origin ${branch}${forceFlag}`, cwd);
}
