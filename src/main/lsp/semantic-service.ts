import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LspClient } from './lsp-client';
import { SnapshotRoots } from './snapshot-root';
import type { SnapshotLease } from './snapshot-root';
import { isEscaping } from '../filecontent';
import type { CodeSource, SemanticHighlightRequest, SemanticHighlightResult, SemanticSpan } from '../../shared/code-highlighting';
import { validateSource } from './source-provenance';
import { MAX_DOCUMENT_BYTES } from '../../shared/code-preview';

const REVISION = /^[0-9a-f]{40}$/i;
const MAX_CLIENTS = 12;
const IDLE_MS = 2 * 60 * 1000;

interface ClientEntry {
  pending: Promise<LspClient>;
  client?: LspClient;
  releaseSnapshot?: () => Promise<void>;
  lastUsed: number;
}

const ROUTES: Record<string, { server: string; languageId: string }> = {
  js: { server: 'vtsls', languageId: 'javascript' }, mjs: { server: 'vtsls', languageId: 'javascript' }, cjs: { server: 'vtsls', languageId: 'javascript' }, jsx: { server: 'vtsls', languageId: 'javascriptreact' },
  ts: { server: 'vtsls', languageId: 'typescript' }, mts: { server: 'vtsls', languageId: 'typescript' }, cts: { server: 'vtsls', languageId: 'typescript' }, tsx: { server: 'vtsls', languageId: 'typescriptreact' },
};

function hash(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function decode(data: number[], types: string[], modifiers: string[]) {
  const spans: SemanticSpan[] = [];
  let line = 0;
  let start = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    line += data[index];
    start = data[index] === 0 ? start + data[index + 1] : data[index + 1];
    const mask = data[index + 4];
    spans.push({ line, start, length: data[index + 2], type: types[data[index + 3]] ?? 'variable', modifiers: modifiers.filter((_, bit) => (mask & (1 << bit)) !== 0) });
  }
  return spans;
}

class SemanticService {
  private readonly snapshots = new SnapshotRoots();
  private readonly clients = new Map<string, ClientEntry>();
  private readonly active = new Set<Promise<void>>();
  private readonly cleanups = new Set<Promise<void>>();
  private admission = Promise.resolve();
  private disposed = false;
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly runtimeRoot: string) {}

  private async client(server: string, root: string, historical: boolean, snapshot?: SnapshotLease) {
    if (this.disposed) return Promise.reject(new Error('semantic service is shutting down'));
    const key = `${server}\0${root}`;
    const entry = await this.withAdmission(async () => {
      if (this.disposed) throw new Error('semantic service is shutting down');
      let entry = this.clients.get(key);
      if (!entry) {
        await this.ensureCapacity();
        if (this.disposed) throw new Error('semantic service is shutting down');
        if (this.clients.size >= MAX_CLIENTS) throw new Error('language server capacity reached');
        const releaseSnapshot = snapshot?.retain();
        const pending = LspClient.start(this.runtimeRoot, server, root, historical);
        entry = { pending, releaseSnapshot, lastUsed: Date.now() };
        this.clients.set(key, entry);
        void pending.then((client) => {
          if (this.clients.get(key) === entry) entry!.client = client;
        }, async () => {
          if (this.clients.get(key) !== entry) return;
          this.clients.delete(key);
          clearTimeout(this.idleTimers.get(key));
          this.idleTimers.delete(key);
          await releaseSnapshot?.();
        }).catch(() => undefined);
      }
      entry.lastUsed = Date.now();
      this.armIdle(key, root, historical);
      return entry;
    });
    return entry.pending;
  }

  private withAdmission<T>(operation: () => Promise<T>) {
    const run = this.admission.then(operation, operation);
    this.admission = run.then(() => undefined, () => undefined);
    return run;
  }

  private async ensureCapacity() {
    if (this.clients.size < MAX_CLIENTS) return;
    const idle = [...this.clients.entries()]
      .filter(([, entry]) => entry.client?.idle)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (!idle) return;
    const [key] = idle;
    const separator = key.indexOf('\0');
    await this.evict(key, key.slice(separator + 1), true);
  }

  private armIdle(key: string, root: string, historical: boolean) {
    clearTimeout(this.idleTimers.get(key));
    this.idleTimers.set(key, setTimeout(() => this.trackCleanup(this.evict(key, root, historical)), IDLE_MS));
  }

  private trackCleanup(cleanup: Promise<void>) {
    this.cleanups.add(cleanup);
    void cleanup.then(() => this.cleanups.delete(cleanup), () => this.cleanups.delete(cleanup));
  }

  private async evict(key: string, root: string, historical: boolean) {
    const entry = this.clients.get(key);
    if (!entry) return;
    const client = await entry.pending.catch(() => null);
    if (this.clients.get(key) !== entry) return;
    if (client && !client.idle) return void this.armIdle(key, root, historical);
    this.clients.delete(key);
    this.idleTimers.delete(key);
    await client?.stop();
    if (historical) await entry.releaseSnapshot?.();
  }

  async highlight(request: SemanticHighlightRequest): Promise<SemanticHighlightResult> {
    if (this.disposed) return { ok: false, source: request.source, spans: [], reason: 'semantic service is shutting down' };
    let release!: () => void;
    const lease = new Promise<void>((resolve) => { release = resolve; });
    this.active.add(lease);
    try {
      return await this.runHighlight(request);
    } finally {
      release();
      this.active.delete(lease);
    }
  }

  private async runHighlight(request: SemanticHighlightRequest): Promise<SemanticHighlightResult> {
    const fail = (reason: string): SemanticHighlightResult => ({ ok: false, source: request.source, spans: [], reason });
    if (!request || typeof request.project !== 'string' || typeof request.path !== 'string' || isEscaping(request.path)) return fail('invalid request');
    const route = ROUTES[path.extname(request.path).slice(1).toLowerCase()];
    if (!route) return fail('unsupported language');
    const project = fs.realpathSync(request.project);
    const issuedSource = validateSource(project, request.path, request.source);
    if (!issuedSource) return fail('source is no longer authorized');
    request = { ...request, source: issuedSource };
    let root = project;
    let snapshot: SnapshotLease | undefined;
    if (request.source.kind === 'revision') {
      if (!REVISION.test(request.source.revision)) return fail('invalid revision');
      snapshot = await this.snapshots.acquire(project, request.source.revision);
      root = snapshot.root;
    }
    try {
      const absolute = fs.realpathSync(path.resolve(root, request.path));
      const relative = path.relative(fs.realpathSync(root), absolute);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return fail('invalid path');
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) return fail('file is too large');
      const text = fs.readFileSync(absolute, 'utf8');
      const source: CodeSource = { ...request.source, contentHash: hash(text) };
      if (request.source.contentHash && source.contentHash !== request.source.contentHash) return { ok: false, source, spans: [], reason: 'source changed' };
      let client = await this.client(route.server, root, request.source.kind === 'revision', snapshot);
      if (!client.alive) {
        const key = `${route.server}\0${root}`;
        const entry = this.clients.get(key);
        if (entry && await entry.pending.catch(() => null) === client && this.clients.get(key) === entry) {
          this.clients.delete(key);
          await entry.releaseSnapshot?.();
        }
        client = await this.client(route.server, root, request.source.kind === 'revision', snapshot);
      }
      let tokens;
      try {
        tokens = await client.serializedSemanticTokens(request.path, route.languageId, text);
      } catch (error) {
        if (client.alive) return fail((error as Error).message);
        const key = `${route.server}\0${root}`;
        const entry = this.clients.get(key);
        if (entry && await entry.pending.catch(() => null) === client && this.clients.get(key) === entry) {
          this.clients.delete(key);
          await entry.releaseSnapshot?.();
        }
        await client.stop();
        return fail((error as Error).message);
      }
      if (!tokens) return { ok: true, source, spans: [] };
      return { ok: true, source, spans: decode(tokens.data, client.tokenTypes, client.tokenModifiers) };
    } finally {
      await snapshot?.release();
    }
  }

  async dispose() {
    this.disposed = true;
    await this.admission;
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    const entries = [...this.clients.values()];
    const settled = await Promise.allSettled(entries.map((entry) => entry.pending));
    await Promise.allSettled(settled.flatMap((result) => result.status === 'fulfilled' ? [result.value.stop()] : []));
    await Promise.allSettled(this.active);
    await Promise.allSettled(this.cleanups);
    await Promise.allSettled(entries.flatMap((entry) => entry.releaseSnapshot ? [entry.releaseSnapshot()] : []));
    this.clients.clear();
    await this.snapshots.dispose();
  }
}

export { SemanticService, decode, ROUTES };
