import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource, createMessageConnection, StreamMessageReader, StreamMessageWriter, Trace, type MessageConnection } from 'vscode-jsonrpc/node';
import { killChildTree } from '../prockill';

interface RuntimeManifest {
  entries: Record<string, string>;
}

interface SemanticTokens {
  data: number[];
}

interface InitializeResult {
  capabilities?: {
    semanticTokensProvider?: { legend?: { tokenTypes?: string[]; tokenModifiers?: string[] } };
  };
}

const REQUEST_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 1_500;
const TOKEN_TYPES = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'];
const TOKEN_MODIFIERS = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'];

function timeout<T>(promise: Promise<T>, ms = REQUEST_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('language server request timed out')), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

class LspClient {
  private queue = Promise.resolve();
  private stopped = false;
  private stopPromise?: Promise<void>;
  private requests = 0;
  private pending = 0;
  private constructor(
    private readonly child: ChildProcess,
    private readonly connection: MessageConnection,
    private readonly root: string,
    readonly tokenTypes: string[],
    readonly tokenModifiers: string[],
    readonly supportsSemanticTokens: boolean,
    private readonly health = { failed: false },
  ) {}

  get alive() { return !this.stopped && !this.health.failed && this.child.exitCode === null && this.child.signalCode === null; }
  get idle() { return this.requests === 0 && this.pending === 0; }

  static async start(runtimeRoot: string, server: string, root: string, historical: boolean) {
    const manifest = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(path.join(runtimeRoot, 'runtime.json'), 'utf8'))) as RuntimeManifest;
    const entry = manifest.entries[server];
    if (!entry) throw new Error(`unknown language server: ${server}`);
    const executable = path.join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node');
    const child = spawn(executable, [path.join(runtimeRoot, 'app', entry), '--stdio'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    if (!child.stdin || !child.stdout) throw new Error('language server stdio unavailable');
    child.stderr?.on('data', (chunk) => { if (process.env.LANTERN_LSP_DEBUG) process.stderr.write(chunk); });
    const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
    const health = { failed: false };
    connection.onClose(() => { health.failed = true; });
    connection.onError(() => { health.failed = true; });
    connection.onRequest('workspace/configuration', (params: { items?: { section?: string }[] }) => (params.items ?? []).map((item) => {
      if (item.section === 'typescript') return { disableAutomaticTypeAcquisition: true, tsserver: { pluginPaths: [], useSyntaxServer: 'auto' } };
      if (item.section === 'vtsls') return { autoUseWorkspaceTsdk: false, tsserver: { globalPlugins: [] } };
      return {};
    }));
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('client/unregisterCapability', () => null);
    connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(root).href, name: path.basename(root) }]);
    connection.onRequest('workspace/semanticTokens/refresh', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.listen();
    if (process.env.LANTERN_LSP_DEBUG) void connection.trace(Trace.Verbose, { log: (message) => process.stderr.write(`${message}\n`) });
    const rootUri = pathToFileURL(root).href;
    let result: InitializeResult;
    try {
      result = await timeout(connection.sendRequest('initialize', {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(root) }],
        capabilities: { textDocument: { semanticTokens: { requests: { full: true }, tokenTypes: TOKEN_TYPES, tokenModifiers: TOKEN_MODIFIERS, formats: ['relative'] } }, workspace: { configuration: true, workspaceFolders: true } },
        initializationOptions: server === 'vtsls' && historical ? { typescript: { disableAutomaticTypeAcquisition: true }, vtsls: { experimental: { completion: { enableServerSideFuzzyMatch: false } } } } : {},
      }) as Promise<InitializeResult>);
    } catch (error) {
      connection.dispose();
      if (child.exitCode === null && child.signalCode === null) await killChildTree(child, SHUTDOWN_TIMEOUT_MS);
      throw error;
    }
    connection.sendNotification('initialized', {});
    const legend = result.capabilities?.semanticTokensProvider?.legend;
    return new LspClient(child, connection, root, legend?.tokenTypes ?? [], legend?.tokenModifiers ?? [], !!legend, health);
  }

  async semanticTokens(file: string, languageId: string, text: string) {
    if (this.stopped) throw new Error('language server is shutting down');
    if (!this.supportsSemanticTokens) return null;
    this.requests++;
    const uri = pathToFileURL(path.join(this.root, file)).href;
    this.connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
    const cancellation = new CancellationTokenSource();
    try {
      return await timeout(this.connection.sendRequest('textDocument/semanticTokens/full', { textDocument: { uri } }, cancellation.token) as Promise<SemanticTokens | null>);
    } catch (error) {
      cancellation.cancel();
      throw error;
    } finally {
      cancellation.dispose();
      this.connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
      this.requests--;
    }
  }

  serializedSemanticTokens(file: string, languageId: string, text: string) {
    if (this.stopped) return Promise.reject(new Error('language server is shutting down'));
    if (this.pending >= 8) return Promise.reject(new Error('language server queue is full'));
    this.pending++;
    const run = this.queue.then(() => this.semanticTokens(file, languageId, text));
    this.queue = run.then(() => { this.pending--; }, () => { this.pending--; });
    return run;
  }

  stop() {
    this.stopPromise ??= this.stopClient();
    return this.stopPromise;
  }

  private async stopClient() {
    this.stopped = true;
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try {
        await timeout(this.connection.sendRequest('shutdown') as Promise<unknown>, SHUTDOWN_TIMEOUT_MS);
        this.connection.sendNotification('exit');
      } catch {}
    }
    this.connection.dispose();
    if (this.child.exitCode === null && this.child.signalCode === null) await killChildTree(this.child, SHUTDOWN_TIMEOUT_MS);
  }
}

export { LspClient };
