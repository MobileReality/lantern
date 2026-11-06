import { highlightLines } from './syntax-highlighting';

interface Request { id: number; items: { lang: string; text: string }[] }

self.onmessage = ({ data }: MessageEvent<Request>) => {
  const { id, items } = data;
  try { self.postMessage({ id, lines: items.map(({ lang, text }) => highlightLines(text, lang)) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
