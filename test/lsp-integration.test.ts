import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LspClient } from '../src/main/lsp/lsp-client';
import { decode } from '../src/main/lsp/semantic-service';

const runtime = process.env.LANTERN_LSP_RUNTIME ? path.resolve(process.env.LANTERN_LSP_RUNTIME) : path.resolve(__dirname, '../out/lsp-runtime');
const servers = ['vtsls'];
let root: string;

beforeAll(() => {
  if (!fs.existsSync(path.join(runtime, 'runtime.json'))) throw new Error('run pnpm compile before the LSP integration test');
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-lsp-test-'));
  fs.writeFileSync(path.join(root, 'types.ts'), 'export interface User { name: string }\n');
  fs.writeFileSync(path.join(root, 'main.ts'), "import type { User } from './types';\nconst user: User = { name: 'Ada' };\nconsole.log(user.name);\n");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const runtimeDescribe = fs.existsSync(path.join(runtime, 'runtime.json')) ? describe : describe.skip;

runtimeDescribe('generated LSP runtime', () => {
  it('fails cleanly when the bundled Node executable is missing', async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-lsp-broken-'));
    try {
      fs.writeFileSync(path.join(broken, 'runtime.json'), JSON.stringify({ entries: { vtsls: 'server.js' } }));
      await expect(LspClient.start(broken, 'vtsls', root, false)).rejects.toBeTruthy();
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });

  for (const server of servers) {
    it(`initializes ${server}`, async () => {
      const client = await LspClient.start(runtime, server, root, false);
      await client.stop();
    }, 20_000);
  }

  it('classifies symbols across TypeScript files with the real vtsls server', async () => {
    const client = await LspClient.start(runtime, 'vtsls', root, false);
    try {
      expect(client.supportsSemanticTokens).toBe(true);
      const text = fs.readFileSync(path.join(root, 'main.ts'), 'utf8');
      const tokens = await client.semanticTokens('main.ts', 'typescript', text);
      const spans = decode(tokens?.data ?? [], client.tokenTypes, client.tokenModifiers);
      expect(spans.some((span) => span.type === 'interface' || span.type === 'type')).toBe(true);
      expect(spans.some((span) => span.type === 'property')).toBe(true);
    } finally {
      await client.stop();
    }
  }, 20_000);
});
