import { AUTH_ERROR } from '@shared/auth-kinds';
import { describe, expect, it } from 'vitest';
import { PROJECT, WORKSPACE_URL, ipcWorld, keysDeep } from './helpers/auth-ipc-world';

describe('auth IPC', () => {
  it('registers exactly the channels of the design', async () => {
    const { handlers } = await ipcWorld();
    expect([...handlers.keys()].sort()).toEqual([
      'auth:add-token',
      'auth:bind',
      'auth:project',
      'auth:remove-profile',
      'auth:rename-profile',
      'auth:set-email',
      'auth:set-expiry',
      'auth:status',
      'auth:unbind',
    ]);
  });

  it('answers the status of a project with the profiles and the choice', async () => {
    const { call, home } = await ipcWorld();
    call('auth:bind', { provider: 'github', profileId: home.id, project: PROJECT });
    const reply = call('auth:status', PROJECT);
    expect(reply).toMatchObject({ ok: true, status: { project: PROJECT, providers: { github: { bound: home.id, binding: 'bound' } } } });
  });

  it('binds, unbinds and removes through the channels and tells the windows', async () => {
    const { call, work, home, pushes } = await ipcWorld();
    pushes.length = 0;
    expect(call('auth:bind', { provider: 'github', profileId: work.id, project: PROJECT })).toMatchObject({ ok: true });
    expect(call('auth:unbind', { provider: 'github', project: PROJECT })).toMatchObject({ ok: true });
    expect(call('auth:remove-profile', { profileId: home.id, project: PROJECT })).toMatchObject({ ok: true });
    expect(pushes).toEqual(Array(3).fill({ channel: 'auth:changed', payload: { provider: 'github' } }));
  });

  it('reports a binding mistake as an error code, not a thrown error', async () => {
    const { call, work } = await ipcWorld();
    expect(call('auth:bind', { provider: 'github', profileId: 'missing', project: PROJECT })).toEqual({ ok: false, error: AUTH_ERROR.unknownProfile });
    expect(call('auth:bind', { provider: 'jira', profileId: work.id, project: PROJECT })).toEqual({ ok: false, error: AUTH_ERROR.wrongProvider });
    expect(call('auth:remove-profile', { profileId: 'missing' })).toEqual({ ok: false, error: AUTH_ERROR.unknownProfile });
  });

  it.each([
    ['auth:status', 42],
    ['auth:status', 'relative/dir'],
    ['auth:status', '/work/\0evil'],
    ['auth:status', `/${'a'.repeat(5000)}`],
    ['auth:bind', null],
    ['auth:bind', { provider: 'gitlab', profileId: 'p', project: PROJECT }],
    ['auth:bind', { provider: 'github', profileId: '../../etc/passwd', project: PROJECT }],
    ['auth:bind', { provider: 'github', profileId: 'profile-1' }],
    ['auth:bind', { provider: 'github', profileId: 'profile-1', project: 'not/absolute' }],
    ['auth:unbind', { provider: ['github'], project: PROJECT }],
    ['auth:unbind', { provider: 'github' }],
    ['auth:remove-profile', { profileId: { $ne: 1 } }],
    ['auth:remove-profile', 'profile-1'],
  ])('rejects malformed input to %s: %j', async (channel, arg) => {
    const { call } = await ipcWorld();
    expect(call(channel, arg)).toEqual({ ok: false, error: AUTH_ERROR.invalidRequest });
  });

  it('ignores callers that are not a trusted window', async () => {
    const { call, mainFrame } = await ipcWorld();
    expect(call('auth:status', PROJECT, { sender: {}, senderFrame: mainFrame })).toBeUndefined();
  });

  it('ignores a trusted window whose frame is not our workspace page', async () => {
    const { call, trustedContents, mainFrame } = await ipcWorld();
    const subframe = { url: WORKSPACE_URL };
    expect(call('auth:status', PROJECT, { sender: trustedContents, senderFrame: subframe })).toBeUndefined();
    expect(call('auth:status', PROJECT, { sender: trustedContents, senderFrame: null })).toBeUndefined();
    mainFrame.url = 'https://evil.test/renderer/workspace.html';
    expect(call('auth:status', PROJECT)).toBeUndefined();
    mainFrame.url = 'file:///tmp/other.html';
    expect(call('auth:status', PROJECT)).toBeUndefined();
    mainFrame.url = 'not a url';
    expect(call('auth:status', PROJECT)).toBeUndefined();
  });

  it('accepts the pop-out window, which loads the same page with a query', async () => {
    const { call, mainFrame } = await ipcWorld();
    mainFrame.url = 'file:///app/renderer/workspace.html?popout=lantern&project=%2Fwork%2Fshop';
    expect(call('auth:status', PROJECT)).toMatchObject({ ok: true });
  });
});

describe('no channel returns a token', () => {
  it('has no token-like field and none of the real token values in any reply or push', async () => {
    const { call, pushes, work, home, drivers, auth, clock } = await ipcWorld();
    const driver = drivers.github;
    clock.advance(3_000_000);
    await auth.credentialFor('github', PROJECT);
    call('auth:bind', { provider: 'github', profileId: work.id, project: PROJECT });
    const replies = [
      call('auth:status'),
      call('auth:status', PROJECT),
      call('auth:bind', { provider: 'github', profileId: home.id, project: PROJECT }),
      call('auth:unbind', { provider: 'github', project: PROJECT }),
      call('auth:bind', { provider: 'github', profileId: 'missing', project: PROJECT }),
    ];
    const everything = JSON.stringify([replies, pushes]);
    for (const secret of ['github-access-', 'github-refresh-', driver?.lastRefreshToken()]) expect(everything).not.toContain(secret as string);
    expect(keysDeep([replies, pushes]).filter((key) => /token|secret|password|code|verifier/i.test(key))).toEqual([]);
  });

  it('keeps the status of a project free of token fields', async () => {
    const { auth } = await ipcWorld();
    const status = auth.status(PROJECT);
    expect(keysDeep(status).filter((key) => /token|secret|password|code|verifier/i.test(key))).toEqual([]);
    expect(Object.keys(status.providers.github.profiles[0]).sort()).toEqual(['createdAt', 'displayName', 'email', 'expiresAt', 'expirySource', 'id', 'kind', 'login', 'nickname', 'provider', 'site', 'state']);
  });
});
