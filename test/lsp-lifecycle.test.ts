import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LspClient } from '../src/main/lsp/lsp-client';
import { SemanticService } from '../src/main/lsp/semantic-service';
import { SnapshotRoots } from '../src/main/lsp/snapshot-root';
import { issueSource } from '../src/main/lsp/source-provenance';
import { commitFile, makeWorld } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

let world: World | undefined;
let service: SemanticService | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await service?.dispose();
  if (world) fs.rmSync(world.dir, { recursive: true, force: true });
  world = undefined;
  service = undefined;
});

function fakeClient() {
  return {
    alive: true,
    idle: true,
    tokenTypes: [],
    tokenModifiers: [],
    serializedSemanticTokens: vi.fn().mockResolvedValue(null),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as LspClient;
}

describe('semantic service lifecycle', () => {
  it('bounds the real serialized client queue at eight pending requests', async () => {
    let finish!: () => void;
    const blocked = new Promise<null>((resolve) => { finish = () => resolve(null); });
    const client = Object.assign(Object.create(LspClient.prototype), {
      stopped: false, pending: 0, requests: 0, queue: Promise.resolve(),
      semanticTokens: vi.fn().mockReturnValue(blocked),
    }) as LspClient;
    const requests = Array.from({ length: 8 }, (_, index) => client.serializedSemanticTokens(`${index}.ts`, 'typescript', ''));
    await expect(client.serializedSemanticTokens('overflow.ts', 'typescript', '')).rejects.toThrow('language server queue is full');
    finish();
    await Promise.all(requests);
  });

  it('reports a live child with a failed transport as dead', () => {
    const client = Object.assign(Object.create(LspClient.prototype), {
      stopped: false, health: { failed: true }, child: { exitCode: null, signalCode: null },
    }) as LspClient;
    expect(client.alive).toBe(false);
  });

  it('treats queued client work as busy', () => {
    const client = Object.assign(Object.create(LspClient.prototype), { requests: 0, pending: 1 }) as LspClient;
    expect(client.idle).toBe(false);
  });

  it('does not start a client after shutdown begins while a snapshot is pending', async () => {
    world = makeWorld();
    const revision = commitFile(world.project, 'src/deferred.ts', 'export const deferred = true;\n', 'deferred');
    const source = issueSource(fs.realpathSync(world.project), 'src/deferred.ts', { kind: 'revision', revision, contentHash: '' });
    let resolveSnapshot!: (value: Awaited<ReturnType<SnapshotRoots['acquire']>>) => void;
    const pendingSnapshot = new Promise<Awaited<ReturnType<SnapshotRoots['acquire']>>>((resolve) => { resolveSnapshot = resolve; });
    vi.spyOn(SnapshotRoots.prototype, 'acquire').mockReturnValue(pendingSnapshot);
    const start = vi.spyOn(LspClient, 'start').mockResolvedValue(fakeClient());
    service = new SemanticService('unused');

    const highlight = service.highlight({ project: world.project, path: 'src/deferred.ts', source });
    const dispose = service.dispose();
    resolveSnapshot({ root: world.project, retain: () => async () => {}, release: async () => {} });

    await expect(highlight).rejects.toThrow('semantic service is shutting down');
    await dispose;
    expect(start).not.toHaveBeenCalled();
    service = undefined;
  });

  it('drains queued admission before shutdown snapshots the clients', async () => {
    service = new SemanticService('unused');
    let releaseAdmission!: () => void;
    const gate = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const internals = service as unknown as {
      admission: Promise<void>;
      client(server: string, root: string, historical: boolean): Promise<LspClient>;
      clients: Map<string, unknown>;
    };
    internals.admission = gate;
    const start = vi.spyOn(LspClient, 'start').mockResolvedValue(fakeClient());
    const queued = internals.client('vtsls', '/tmp/project', false);
    const dispose = service.dispose();
    releaseAdmission();

    await expect(queued).rejects.toThrow('semantic service is shutting down');
    await dispose;
    expect(start).not.toHaveBeenCalled();
    expect(internals.clients.size).toBe(0);
    service = undefined;
  });

  it('reclaims clientless snapshots after missing files across more than the root cap', async () => {
    world = makeWorld();
    const start = vi.spyOn(LspClient, 'start').mockResolvedValue(fakeClient());
    service = new SemanticService('unused');

    for (let index = 0; index < 13; index++) {
      const revision = commitFile(world.project, 'revision.txt', `${index}\n`, `revision ${index}`);
      const source = issueSource(fs.realpathSync(world.project), 'src/missing.ts', { kind: 'revision', revision, contentHash: '' });
      await expect(service.highlight({ project: world.project, path: 'src/missing.ts', source })).rejects.toThrow();
    }

    const revision = commitFile(world.project, 'src/valid.ts', 'export const valid = true;\n', 'valid');
    const source = issueSource(fs.realpathSync(world.project), 'src/valid.ts', { kind: 'revision', revision, contentHash: '' });
    await expect(service.highlight({ project: world.project, path: 'src/valid.ts', source })).resolves.toMatchObject({ ok: true });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('waits for an eviction cleanup already in flight during shutdown', async () => {
    world = makeWorld();
    const revision = commitFile(world.project, 'src/evicted.ts', 'export const evicted = true;\n', 'evicted');
    const source = issueSource(fs.realpathSync(world.project), 'src/evicted.ts', { kind: 'revision', revision, contentHash: '' });
    let finishStop!: () => void;
    const stop = new Promise<void>((resolve) => { finishStop = resolve; });
    const client = fakeClient();
    vi.spyOn(client, 'stop').mockReturnValue(stop);
    vi.spyOn(LspClient, 'start').mockResolvedValue(client);
    service = new SemanticService('unused');
    await service.highlight({ project: world.project, path: 'src/evicted.ts', source });

    const clients = (service as unknown as { clients: Map<string, unknown> }).clients;
    const key = [...clients.keys()][0];
    expect(key).toBeDefined();
    const separator = key!.indexOf('\0');
    const eviction = (service as unknown as { evict: (key: string, root: string, historical: boolean) => Promise<void> })
      .evict(key!, key!.slice(separator + 1), true);
    (service as unknown as { trackCleanup: (cleanup: Promise<void>) => void }).trackCleanup(eviction);
    await Promise.resolve();
    let disposed = false;
    const dispose = service.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);

    finishStop();
    await eviction;
    await dispose;
    service = undefined;
  });

  it('keeps a live shared server after a nonfatal request error', async () => {
    world = makeWorld();
    fs.writeFileSync(path.join(world.project, 'src/live.ts'), 'export const live = true;\n');
    const source = issueSource(fs.realpathSync(world.project), 'src/live.ts', { kind: 'working-tree', revision: 'working-tree', contentHash: '' });
    const client = fakeClient();
    vi.spyOn(client, 'serializedSemanticTokens').mockRejectedValueOnce(new Error('language server queue is full')).mockResolvedValueOnce(null);
    const start = vi.spyOn(LspClient, 'start').mockResolvedValue(client);
    service = new SemanticService('unused');

    await expect(service.highlight({ project: world.project, path: 'src/live.ts', source })).resolves.toMatchObject({ ok: false, reason: 'language server queue is full' });
    await expect(service.highlight({ project: world.project, path: 'src/live.ts', source })).resolves.toMatchObject({ ok: true });
    expect(start).toHaveBeenCalledOnce();
    expect(client.stop).not.toHaveBeenCalled();
  });

  it('evicts the least recently used idle client before admitting a thirteenth historical root', async () => {
    world = makeWorld();
    const clients = Array.from({ length: 13 }, () => fakeClient());
    const start = vi.spyOn(LspClient, 'start');
    clients.forEach((client) => { start.mockResolvedValueOnce(client); });
    service = new SemanticService('unused');

    for (let index = 0; index < 13; index++) {
      const file = `src/revision-${index}.ts`;
      const revision = commitFile(world.project, file, `export const value = ${index};\n`, `revision ${index}`);
      const source = issueSource(fs.realpathSync(world.project), file, { kind: 'revision', revision, contentHash: '' });
      await expect(service.highlight({ project: world.project, path: file, source })).resolves.toMatchObject({ ok: true });
    }

    expect(start).toHaveBeenCalledTimes(13);
    expect(clients[0].stop).toHaveBeenCalledOnce();
  });

  it('admits twelve concurrent historical clients without evicting one that is starting', async () => {
    world = makeWorld();
    const clients = Array.from({ length: 12 }, () => fakeClient());
    const start = vi.spyOn(LspClient, 'start');
    clients.forEach((client) => { start.mockResolvedValueOnce(client); });
    service = new SemanticService('unused');
    const requests = [];
    for (let index = 0; index < 12; index++) {
      const file = `src/concurrent-${index}.ts`;
      const revision = commitFile(world.project, file, `export const value = ${index};\n`, `concurrent ${index}`);
      const source = issueSource(fs.realpathSync(world.project), file, { kind: 'revision', revision, contentHash: '' });
      requests.push(service.highlight({ project: world.project, path: file, source }));
    }

    const results = await Promise.all(requests);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(start).toHaveBeenCalledTimes(12);
    expect(clients.every((client) => !vi.mocked(client.stop).mock.calls.length)).toBe(true);
  });
});
