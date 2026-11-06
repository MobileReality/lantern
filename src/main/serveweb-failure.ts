const TAIL_LINES = 5;
const PORT_IN_USE = /could not start server|address already in use|EADDRINUSE/i;

export interface OutputTail {
  push(line: string): void;
  lines(): string[];
}

export function createOutputTail(limit = TAIL_LINES): OutputTail {
  const kept: string[] = [];
  return {
    push(line) {
      const text = line.trim();
      if (!text) return;
      kept.push(text);
      if (kept.length > limit) kept.shift();
    },
    lines: () => [...kept],
  };
}

export function describeEarlyExit(lines: string[], port: number): string {
  if (lines.some((l) => PORT_IN_USE.test(l))) return `Port ${port} is in use. Retry starts the editor on another port.`;
  const generic = 'The VS Code server stopped before the editor was ready.';
  return lines.length ? `${generic} Last output: ${lines.join(' · ')}` : generic;
}
