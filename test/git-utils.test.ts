import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

const { gitFetch, gitPush } = await import('../src/utils/git-utils.js');

const str = (s: string) => ({ trim: () => s });

describe('gitFetch', () => {
  const cwd = '/repo';

  beforeEach(() => {
    execSyncMock.mockReset();
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_TOKEN;
    delete process.env.BITBUCKET_BASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to plain fetch when credentials are not set', () => {
    execSyncMock.mockReturnValue(str(''));
    gitFetch('origin', cwd);
    expect(execSyncMock).toHaveBeenCalledOnce();
    expect(execSyncMock).toHaveBeenCalledWith(
      'git fetch origin',
      expect.any(Object)
    );
  });

  it('rewrites remote URL with credentials and restores it after fetch', () => {
    process.env.BITBUCKET_USERNAME = 'ci-user';
    process.env.BITBUCKET_TOKEN = 'secret';
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';

    const originalUrl = 'https://bitbucket.example.com/BZ/lighthouse.git';
    execSyncMock
      .mockReturnValueOnce(str(originalUrl)) // get-url
      .mockReturnValueOnce(str('')) // set-url (authed)
      .mockReturnValueOnce(str('')) // fetch
      .mockReturnValueOnce(str('')); // set-url (restore)

    gitFetch('origin', cwd);

    const calls = execSyncMock.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('git remote get-url origin');
    expect(calls[1]).toContain('ci-user');
    expect(calls[1]).toContain('secret');
    expect(calls[1]).toContain('bitbucket.example.com');
    expect(calls[2]).toBe('git fetch origin');
    expect(calls[3]).toBe(`git remote set-url origin ${originalUrl}`);
    expect(calls[3]).not.toContain('secret');
  });

  it('restores the original remote URL even when fetch throws', () => {
    process.env.BITBUCKET_USERNAME = 'ci-user';
    process.env.BITBUCKET_TOKEN = 'secret';
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';

    const originalUrl = 'https://bitbucket.example.com/BZ/lighthouse.git';
    execSyncMock
      .mockReturnValueOnce(str(originalUrl)) // get-url
      .mockReturnValueOnce(str('')) // set-url (authed)
      .mockImplementationOnce(() => {
        throw new Error('network error');
      }) // fetch fails
      .mockReturnValueOnce(str('')); // set-url (restore — must still be called)

    expect(() => gitFetch('origin', cwd)).toThrow('network error');

    const restoreCall = execSyncMock.mock.calls[3]?.[0] as string;
    expect(restoreCall).toBeDefined();
    expect(restoreCall).toContain(originalUrl);
    expect(restoreCall).not.toContain('secret');
  });

  it('URL-encodes special characters in username and token', () => {
    process.env.BITBUCKET_USERNAME = 'user@domain.com';
    process.env.BITBUCKET_TOKEN = 'p@ss:word!';
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';

    execSyncMock
      .mockReturnValueOnce(str('https://bitbucket.example.com/BZ/repo.git'))
      .mockReturnValue(str(''));

    gitFetch('origin', cwd);

    const setUrlCall = execSyncMock.mock.calls[1][0] as string;
    expect(setUrlCall).not.toContain('user@domain.com');
    expect(setUrlCall).toContain('user%40domain.com');
    expect(setUrlCall).not.toContain('p@ss:word!');
    expect(setUrlCall).toContain('p%40ss%3Aword!');
  });

  it('falls back to plain fetch when BITBUCKET_BASE_URL is malformed', () => {
    process.env.BITBUCKET_USERNAME = 'ci-user';
    process.env.BITBUCKET_TOKEN = 'secret';
    process.env.BITBUCKET_BASE_URL = 'not-a-valid-url';

    execSyncMock.mockReturnValue(str(''));
    gitFetch('origin', cwd);

    expect(execSyncMock).toHaveBeenCalledOnce();
    expect(execSyncMock).toHaveBeenCalledWith(
      'git fetch origin',
      expect.any(Object)
    );
  });

  it('falls back to plain fetch when remote URL host does not match BITBUCKET_BASE_URL', () => {
    process.env.BITBUCKET_USERNAME = 'ci-user';
    process.env.BITBUCKET_TOKEN = 'secret';
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';

    // Remote uses SSH — replace() will be a no-op
    execSyncMock
      .mockReturnValueOnce(str('git@bitbucket.example.com:BZ/repo.git')) // get-url
      .mockReturnValue(str(''));

    gitFetch('origin', cwd);

    const calls = execSyncMock.mock.calls.map((c) => c[0] as string);
    // should only call get-url + fetch — no set-url calls
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('git fetch origin');
  });

  it('fetches a specific branch when branch param is provided (no credentials)', () => {
    execSyncMock.mockReturnValue(str(''));
    gitFetch('origin', cwd, 'feat/my-branch');
    expect(execSyncMock).toHaveBeenCalledOnce();
    expect(execSyncMock).toHaveBeenCalledWith(
      'git fetch origin feat/my-branch',
      expect.any(Object)
    );
  });

  it('fetches a specific branch with credential injection when branch param is provided', () => {
    process.env.BITBUCKET_USERNAME = 'ci-user';
    process.env.BITBUCKET_TOKEN = 'secret';
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';

    const originalUrl = 'https://bitbucket.example.com/BZ/lighthouse.git';
    execSyncMock
      .mockReturnValueOnce(str(originalUrl)) // get-url
      .mockReturnValueOnce(str('')) // set-url (authed)
      .mockReturnValueOnce(str('')) // fetch
      .mockReturnValueOnce(str('')); // set-url (restore)

    gitFetch('origin', cwd, 'feat/my-branch');

    const calls = execSyncMock.mock.calls.map((c) => c[0] as string);
    expect(calls[2]).toBe('git fetch origin feat/my-branch');
    expect(calls[3]).toBe(`git remote set-url origin ${originalUrl}`);
  });
});

describe('gitPush', () => {
  const cwd = '/repo';

  beforeEach(() => {
    execSyncMock.mockReset();
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_TOKEN;
    delete process.env.BITBUCKET_BASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('injects credentials into remote URL before push and restores afterward', () => {
    process.env.BITBUCKET_USERNAME = 'ci-user';
    process.env.BITBUCKET_TOKEN = 'secret';
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';

    const originalUrl = 'https://bitbucket.example.com/BZ/lighthouse.git';
    execSyncMock
      .mockReturnValueOnce(str(originalUrl)) // get-url
      .mockReturnValueOnce(str('')) // set-url (authed)
      .mockReturnValueOnce(str('')) // push
      .mockReturnValueOnce(str('')); // set-url (restore)

    gitPush('test/my-branch', cwd);

    const calls = execSyncMock.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('git remote get-url origin');
    expect(calls[1]).toContain('ci-user');
    expect(calls[1]).toContain('secret');
    expect(calls[2]).toContain('git push -u origin test/my-branch');
    expect(calls[3]).toBe(`git remote set-url origin ${originalUrl}`);
    expect(calls[3]).not.toContain('secret');
  });

  it('restores remote URL even when push throws', () => {
    process.env.BITBUCKET_USERNAME = 'ci-user';
    process.env.BITBUCKET_TOKEN = 'secret';
    process.env.BITBUCKET_BASE_URL = 'https://bitbucket.example.com';

    const originalUrl = 'https://bitbucket.example.com/BZ/lighthouse.git';
    execSyncMock
      .mockReturnValueOnce(str(originalUrl)) // get-url
      .mockReturnValueOnce(str('')) // set-url (authed)
      .mockImplementationOnce(() => {
        throw new Error('push failed');
      }) // push fails
      .mockReturnValueOnce(str('')); // set-url (restore)

    expect(() => gitPush('test/my-branch', cwd)).toThrow('push failed');

    const restoreCall = execSyncMock.mock.calls[3]?.[0] as string;
    expect(restoreCall).toBeDefined();
    expect(restoreCall).toContain(originalUrl);
    expect(restoreCall).not.toContain('secret');
  });
});
