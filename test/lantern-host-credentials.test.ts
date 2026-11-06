import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ENV_BYTES, parseCredentialLines, readHostCredentials } from '../src/main/lantern-host-credentials';
import { makeTmp, write } from './helpers/git-repo';

let root: string;

beforeEach(() => {
  root = makeTmp('ccm-host-creds-');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const envFile = (text: string) => write(root, '.ai/.env', text);

describe('readHostCredentials', () => {
  it('reads both keys from the environment first', async () => {
    envFile('BITBUCKET_EMAIL=file@example.com\nBITBUCKET_API_TOKEN=file-token\n');
    const env = { BITBUCKET_EMAIL: 'env@example.com', BITBUCKET_API_TOKEN: 'env-token' };
    expect(await readHostCredentials(root, env)).toEqual({ email: 'env@example.com', token: 'env-token' });
  });

  it('fills a key the environment lacks from .ai/.env', async () => {
    envFile('BITBUCKET_EMAIL=file@example.com\nBITBUCKET_API_TOKEN=file-token\n');
    expect(await readHostCredentials(root, { BITBUCKET_API_TOKEN: 'env-token' })).toEqual({ email: 'file@example.com', token: 'env-token' });
  });

  it('reads quoted and exported values', async () => {
    envFile('# the host\nexport BITBUCKET_EMAIL="q@example.com"\nBITBUCKET_API_TOKEN=\'tok_1\' \n');
    expect(await readHostCredentials(root, {})).toEqual({ email: 'q@example.com', token: 'tok_1' });
  });

  it('returns null with nothing configured', async () => {
    expect(await readHostCredentials(root, {})).toBeNull();
  });

  it('returns null when only one key is present', async () => {
    envFile('BITBUCKET_EMAIL=file@example.com\n');
    expect(await readHostCredentials(root, {})).toBeNull();
  });

  it('skips a symlinked .ai/.env', async () => {
    write(root, 'real.env', 'BITBUCKET_EMAIL=a@example.com\nBITBUCKET_API_TOKEN=tok\n');
    fs.mkdirSync(path.join(root, '.ai'));
    fs.symlinkSync(path.join(root, 'real.env'), path.join(root, '.ai/.env'));
    expect(await readHostCredentials(root, {})).toBeNull();
  });

  it('skips a file reached through a symlinked .ai directory', async () => {
    write(root, 'shared/.env', 'BITBUCKET_EMAIL=a@example.com\nBITBUCKET_API_TOKEN=tok\n');
    fs.symlinkSync(path.join(root, 'shared'), path.join(root, '.ai'));
    expect(await readHostCredentials(root, {})).toBeNull();
  });

  it('skips an oversized .ai/.env even when the keys come first', async () => {
    envFile(`BITBUCKET_EMAIL=a@example.com\nBITBUCKET_API_TOKEN=tok\n${'# padding\n'.repeat(MAX_ENV_BYTES / 9)}`);
    expect(fs.statSync(path.join(root, '.ai/.env')).size).toBeGreaterThan(MAX_ENV_BYTES);
    expect(await readHostCredentials(root, {})).toBeNull();
  });

  it('skips a directory standing where the file should be', async () => {
    fs.mkdirSync(path.join(root, '.ai/.env'), { recursive: true });
    expect(await readHostCredentials(root, {})).toBeNull();
  });

  it('rejects values that are not plain printable text', async () => {
    expect(await readHostCredentials(root, { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'has space' })).toBeNull();
    expect(await readHostCredentials(root, { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'line\nbreak' })).toBeNull();
    expect(await readHostCredentials(root, { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'x'.repeat(513) })).toBeNull();
  });
});

describe('parseCredentialLines', () => {
  it('returns only the two credential keys and treats everything else as text to ignore', () => {
    const text = ['AWS_SECRET_ACCESS_KEY=hunter2', 'BITBUCKET_EMAIL=a@example.com', '$(touch /tmp/pwned)', '`id`', 'BITBUCKET_API_TOKEN=tok', 'GITHUB_TOKEN=gh'].join('\n');
    expect(parseCredentialLines(text)).toEqual({ BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'tok' });
  });

  it('keeps shell syntax in a value as literal text', () => {
    expect(parseCredentialLines('BITBUCKET_API_TOKEN=$(whoami)')).toEqual({ BITBUCKET_API_TOKEN: '$(whoami)' });
  });

  it('takes the first of a repeated key and survives CRLF', () => {
    expect(parseCredentialLines('BITBUCKET_EMAIL=first@example.com\r\nBITBUCKET_EMAIL=second@example.com\r\n')).toEqual({ BITBUCKET_EMAIL: 'first@example.com' });
  });

  it('drops a trailing comment on an unquoted value', () => {
    expect(parseCredentialLines('BITBUCKET_EMAIL=a@example.com # work')).toEqual({ BITBUCKET_EMAIL: 'a@example.com' });
  });
});
