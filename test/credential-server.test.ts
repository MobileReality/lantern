import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_REFUSAL } from '@shared/auth-kinds';
import { LIMITS, credentialSocketPath, parseCredentialRequest } from '@main/auth/credential-socket';
import type { Auth } from '@main/auth';
import { createAuthWorld } from './helpers/auth-world';
import { GITHUB_HOST, createCredentialWorld } from './helpers/credential-world';

const SITE = 'https://acme.atlassian.net';
const GITHUB_TOKEN = 'ghp_work_token_value';
const JIRA_TOKEN = 'jira_work_token_value';
const POSIX = process.platform !== 'win32';

const refused = (reason: string) => ({ ok: false, reason });

describe('the credential server answers with the variables an agent run would get', () => {
  it('serves the only account of the project host', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    expect(await world.ask(world.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('serves exactly the injection of the run, Jira site included', async () => {
    const world = await createCredentialWorld();
    world.addStatic('jira', JIRA_TOKEN, 'me@x.test', { email: 'me@x.test', site: SITE });
    const injection = (await world.auth.injectionFor(world.project)).jira;
    const reply = await world.ask(world.project, 'jira');
    expect(reply).toEqual({ ok: true, env: { ...injection?.credentials, ...injection?.context } });
    expect(Object.keys((reply as { env: object }).env).sort()).toEqual(['ATLASSIAN_BASE_URL', 'ATLASSIAN_EMAIL', 'GLOBAL_ATLASSIAN_TOKEN']);
  });

  it('serves the e-mail of a code host account as GIT_COMMIT_EMAIL, and none when the account has none', async () => {
    const withEmail = await createCredentialWorld();
    withEmail.addStatic('github', GITHUB_TOKEN, 'work', { email: 'work@x.test' });
    expect(await withEmail.ask(withEmail.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN, GIT_COMMIT_EMAIL: 'work@x.test' } });
    const without = await createCredentialWorld();
    without.addStatic('github', GITHUB_TOKEN, 'work');
    expect(await without.ask(without.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('serves the account the project is bound to when there are two', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', 'ghp_first_token_value', 'first');
    const second = world.addStatic('github', GITHUB_TOKEN, 'second').profile;
    expect(await world.ask(world.project, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.chooseAccount));
    world.auth.bind('github', second.id, world.project);
    expect(await world.ask(world.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('refuses a project with no account', async () => {
    const world = await createCredentialWorld();
    expect(await world.ask(world.project, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.noAccount));
    expect(await world.ask(world.project, 'jira')).toEqual(refused(CREDENTIAL_REFUSAL.noAccount));
  });

  it('asks for a choice for a provider that is not the project host, even with an account, and says no account for one that has none', async () => {
    const world = await createCredentialWorld();
    expect(await world.ask(world.project, 'bitbucket')).toEqual(refused(CREDENTIAL_REFUSAL.noAccount));
    world.addStatic('bitbucket', 'bb_token_value_1', 'me', { email: 'me@x.test' });
    expect(await world.ask(world.project, 'bitbucket')).toEqual(refused(CREDENTIAL_REFUSAL.chooseAccount));
  });

  it('serves a Bitbucket account pinned to a GitHub project, and the GitHub one as before', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    const bitbucket = world.addStatic('bitbucket', 'bb_token_value_1', 'me', { email: 'me@x.test' }).profile;
    world.auth.bind('bitbucket', bitbucket.id, world.project);
    expect(await world.ask(world.project, 'bitbucket')).toEqual({ ok: true, env: { BITBUCKET_EMAIL: 'me@x.test', BITBUCKET_API_TOKEN: 'bb_token_value_1', GIT_COMMIT_EMAIL: 'me@x.test' } });
    expect(await world.ask(world.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('serves a pinned account to a project with no remote, and only after the pin', async () => {
    const world = await createCredentialWorld({ host: null });
    const work = world.addStatic('github', GITHUB_TOKEN, 'work').profile;
    expect(await world.ask(world.project, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.chooseAccount));
    world.auth.bind('github', work.id, world.project);
    expect(await world.ask(world.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('does not serve a pinned account to a directory that is not an opened project', async () => {
    const world = await createCredentialWorld({ host: null });
    const work = world.addStatic('github', GITHUB_TOKEN, 'work').profile;
    world.auth.bind('github', work.id, world.outside);
    expect(await world.ask(world.outside, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.unknownProject));
  });

  it('refuses when the stored token cannot be read', async () => {
    const earlier = createAuthWorld({ host: GITHUB_HOST });
    earlier.addStatic('github', GITHUB_TOKEN, 'work');
    earlier.cipher.setAvailable(false);
    const locked = await createCredentialWorld({ authWorld: { dir: earlier.dir, cipher: earlier.cipher } });
    expect(await locked.ask(locked.project, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.storeUnavailable));
  });

  it('refuses when the composition fails outright', async () => {
    const own = await createCredentialWorld();
    own.addStatic('github', GITHUB_TOKEN, 'work');
    const failing = await createCredentialWorld({ auth: { project: own.auth.project, injectionFor: async () => Promise.reject(new Error('boom')) } });
    expect(await failing.ask(failing.project, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.storeUnavailable));
  });
});

describe('which directories count as a project', () => {
  it('refuses a directory that is not an opened project', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    expect(await world.ask(world.outside, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.unknownProject));
    expect(await world.ask(path.join(world.root, 'missing'), 'github')).toEqual(refused(CREDENTIAL_REFUSAL.unknownProject));
    expect(await world.ask(world.root, 'github')).toEqual(refused(CREDENTIAL_REFUSAL.unknownProject));
  });

  it.skipIf(!POSIX)('resolves a symlink to the opened project', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    expect(await world.ask(world.link, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it.skipIf(!POSIX)('does not let a symlink inside a project lead out of it', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    fs.symlinkSync(world.outside, path.join(world.project, 'src', 'escape'));
    expect(await world.ask(path.join(world.project, 'src', 'escape'), 'github')).toEqual(refused(CREDENTIAL_REFUSAL.unknownProject));
  });

  it('answers for a folder inside an opened project', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    expect(await world.ask(path.join(world.project, 'src'), 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });
});

describe('what the server never returns', () => {
  it('keeps only the variables of the asked provider', async () => {
    const own = await createCredentialWorld();
    own.addStatic('github', GITHUB_TOKEN, 'work');
    const crowded = await createCredentialWorld({
      auth: {
        project: own.auth.project,
        injectionFor: async () => ({ github: { credentials: { GITHUB_TOKEN, OTHER_SECRET: 'x', PATH: '/bin' }, context: { ATLASSIAN_BASE_URL: SITE } } }),
      },
    });
    expect(await crowded.ask(crowded.project, 'github')).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('refuses a reply that would lack a required variable', async () => {
    const own = await createCredentialWorld();
    const partial = await createCredentialWorld({
      auth: { project: own.auth.project, injectionFor: async () => ({ jira: { credentials: { GLOBAL_ATLASSIAN_TOKEN: JIRA_TOKEN }, context: {} } }) },
    });
    expect(await partial.ask(partial.project, 'jira')).toEqual(refused(CREDENTIAL_REFUSAL.storeUnavailable));
  });

  it('writes no token to the log', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    await world.ask(world.project, 'github');
    await world.ask(world.outside, 'github');
    expect(world.logs.join('\n')).toContain('work');
    expect(world.logs.join('\n')).not.toContain(GITHUB_TOKEN);
  });
});

describe('the connection is bounded', () => {
  it('answers a malformed or unknown request with a bad-request refusal', async () => {
    const world = await createCredentialWorld();
    for (const text of ['not json\n', '[]\n', '{"project":"","provider":"github"}\n', `{"project":"${world.project}","provider":"nope"}\n`, '{"provider":"github"}\n']) {
      expect(JSON.parse(await world.raw(text))).toEqual(refused(CREDENTIAL_REFUSAL.badRequest));
    }
  });

  it('refuses a request larger than the cap and does not wait for its end', async () => {
    const world = await createCredentialWorld();
    expect(JSON.parse(await world.raw('x'.repeat(LIMITS.requestBytes + 1)))).toEqual(refused(CREDENTIAL_REFUSAL.tooLarge));
    expect(JSON.parse(await world.raw(`${' '.repeat(LIMITS.requestBytes + 10)}\n`))).toEqual(refused(CREDENTIAL_REFUSAL.tooLarge));
  });

  it('drops a connection that never finishes its request', async () => {
    const world = await createCredentialWorld({ limits: { ...LIMITS, connectionMs: 60 } });
    const started = Date.now();
    expect(await world.raw('{"project":', 5000)).toBe('');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('handles one request per connection however much more is sent after it', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    const line = `${JSON.stringify({ project: world.project, provider: 'github' })}\n`;
    const net = await import('node:net');
    const reply = await new Promise<string>((resolve) => {
      let received = '';
      const socket = net.createConnection(world.socketPath, () => {
        socket.write(line);
        for (const delay of [5, 15, 25, 35]) setTimeout(() => socket.writable && socket.write(line.repeat(20)), delay);
      });
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (received += chunk));
      socket.on('error', () => {});
      socket.on('close', () => resolve(received));
    });
    expect(reply.trim().split('\n')).toHaveLength(1);
    expect(world.logs.filter((log) => log.includes('served the github account'))).toHaveLength(1);
  });

  it('cuts a connection that keeps sending after the time allowed', async () => {
    const world = await createCredentialWorld({ limits: { ...LIMITS, connectionMs: 120 } });
    const net = await import('node:net');
    const started = Date.now();
    await new Promise<void>((resolve) => {
      const socket = net.createConnection(world.socketPath, () => {
        const timer = setInterval(() => socket.writable && socket.write('x'), 20);
        socket.on('close', () => {
          clearInterval(timer);
          resolve();
        });
      });
      socket.on('error', () => {});
      setTimeout(() => socket.destroy(), 3000);
    });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('answers a request that arrives in pieces', async () => {
    const world = await createCredentialWorld();
    world.addStatic('github', GITHUB_TOKEN, 'work');
    const line = `${JSON.stringify({ project: world.project, provider: 'github' })}\n`;
    const half = Math.floor(line.length / 2);
    const net = await import('node:net');
    const reply = await new Promise<string>((resolve) => {
      let received = '';
      const socket = net.createConnection(world.socketPath, () => {
        socket.write(line.slice(0, half));
        setTimeout(() => socket.write(line.slice(half)), 30);
      });
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (received += chunk));
      socket.on('close', () => resolve(received));
    });
    expect(JSON.parse(reply)).toEqual({ ok: true, env: { GITHUB_TOKEN } });
  });

  it('parses only a project and a known provider', () => {
    expect(parseCredentialRequest('{"project":"/p","provider":"jira","extra":1}')).toEqual({ project: '/p', provider: 'jira' });
    expect(parseCredentialRequest('{"project":1,"provider":"jira"}')).toBeNull();
    expect(parseCredentialRequest('')).toBeNull();
  });
});

describe('where the socket is and who can reach it', () => {
  it.skipIf(!POSIX)('sits in the profile folder with mode 0600', async () => {
    const world = await createCredentialWorld();
    expect(path.dirname(world.socketPath)).toBe(world.userData);
    expect(path.basename(world.socketPath)).toBe('lantern.sock');
    const meta = fs.lstatSync(world.socketPath);
    expect(meta.isSocket()).toBe(true);
    expect(meta.mode & 0o777).toBe(0o600);
    expect(meta.uid).toBe(process.getuid?.());
  });

  it.skipIf(!POSIX)('is removed when the server closes', async () => {
    const world = await createCredentialWorld();
    await world.server.close();
    expect(fs.existsSync(world.socketPath)).toBe(false);
  });

  it.skipIf(!POSIX)('replaces a stale socket left by a crash but not an unrelated file', async () => {
    const world = await createCredentialWorld();
    await world.server.close();
    fs.writeFileSync(world.socketPath, 'a file');
    expect(await world.server.start()).toBe(false);
    expect(fs.readFileSync(world.socketPath, 'utf8')).toBe('a file');
    fs.rmSync(world.socketPath);
    expect(await world.server.start()).toBe(true);
  });

  it('derives its path per platform and profile, apart for the dev profile', () => {
    const at = (platform: NodeJS.Platform, userData: string, dev: boolean) => credentialSocketPath({ userData, platform, username: 'ada', dev });
    expect(at('darwin', '/Users/ada/Library/Application Support/Lantern', false)).toBe('/Users/ada/Library/Application Support/Lantern/lantern.sock');
    expect(at('darwin', '/Users/ada/Library/Application Support/Lantern-dev', true)).toBe('/Users/ada/Library/Application Support/Lantern-dev/lantern.sock');
    expect(at('linux', '/home/ada/.config/Lantern', false)).toBe('/home/ada/.config/Lantern/lantern.sock');
    expect(at('win32', 'C:\\Users\\ada\\AppData\\Roaming\\Lantern', false)).toBe('\\\\.\\pipe\\lantern-credentials-ada');
    expect(at('win32', 'C:\\Users\\ada\\AppData\\Roaming\\Lantern-dev', true)).toBe('\\\\.\\pipe\\lantern-credentials-ada-dev');
  });
});

describe('the server uses the auth composition, not a second selection', () => {
  it('asks the composition once per request with the opened project path', async () => {
    const world = await createCredentialWorld();
    const seen: string[] = [];
    const spy: Pick<Auth, 'injectionFor' | 'project'> = {
      project: world.auth.project,
      injectionFor: async (project) => {
        seen.push(project);
        return {};
      },
    };
    const spied = await createCredentialWorld({ auth: spy });
    await spied.ask(spied.link, 'github');
    expect(seen).toEqual([spied.project]);
  });
});
