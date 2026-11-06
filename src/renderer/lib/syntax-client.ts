interface Item { lang: string | null; text: string }
interface Reply { id: number; lines?: string[][]; error?: string }
const MAX_PENDING = 8;
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { items: Item[]; resolve(value: string[][]): void }>();

const escapeHtml = (text: string) => text.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!);
const fallback = (items: Item[]) => items.map(({ text }) => text.split('\n').map(escapeHtml));
function reset(owner: Worker) {
  if (worker !== owner) return;
  owner.terminate(); worker = null;
  for (const request of pending.values()) request.resolve(fallback(request.items));
  pending.clear();
}
function getWorker() {
  if (worker) return worker;
  const instance = new Worker(new URL('syntax-worker.js', document.baseURI), { name: 'lantern-syntax' });
  worker = instance;
  instance.onmessage = ({ data }: MessageEvent<Reply>) => {
    if (data.error) return reset(instance);
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    request.resolve(data.lines ?? fallback(request.items));
  };
  instance.onerror = () => reset(instance);
  instance.onmessageerror = () => reset(instance);
  return instance;
}

function highlightBatch(items: Item[]): Promise<string[][]> {
  if (!items.length || pending.size >= MAX_PENDING || items.every((item) => !item.lang)) return Promise.resolve(fallback(items));
  const id = ++nextId;
  return new Promise((resolve) => {
    pending.set(id, { items, resolve });
    let instance: Worker | null = null;
    try {
      instance = getWorker();
      instance.postMessage({ id, items: items.map((item) => ({ lang: item.lang ?? '', text: item.text })) });
    } catch {
      pending.delete(id);
      resolve(fallback(items));
      if (instance && worker === instance) reset(instance);
    }
  });
}

export { highlightBatch };
