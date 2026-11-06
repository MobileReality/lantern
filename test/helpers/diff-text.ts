interface Edit {
  line: number;
  to?: string;
  insert?: boolean;
}

const HEADER = ['diff --git a/src/f.ts b/src/f.ts', 'index 111..222 100644', '--- a/src/f.ts', '+++ b/src/f.ts'];

function fullContextDiff(lines: string[], edits: Edit[], tail = true): string {
  const at = new Map(edits.map((e) => [e.line, e]));
  const out: string[] = [];
  let removed = 0;
  let added = 0;
  lines.forEach((text, i) => {
    const edit = at.get(i + 1);
    if (!edit) {
      out.push(` ${text}`);
      return;
    }
    if (edit.insert) {
      out.push(` ${text}`, `+${edit.to}`);
      added++;
      return;
    }
    out.push(`-${text}`);
    removed++;
    if (edit.to !== undefined) {
      out.push(`+${edit.to}`);
      added++;
    }
  });
  const oldCount = lines.length;
  const newCount = lines.length - removed + added;
  return [...HEADER, `@@ -1,${oldCount} +1,${newCount} @@`, ...out].join('\n') + (tail ? '\n' : '');
}

function numbered(count: number, indent = ''): string[] {
  return Array.from({ length: count }, (_, i) => `${indent}const line${i + 1} = ${i + 1};`);
}

function pureAddDiff(lines: string[]): string {
  return [
    'diff --git a/src/n.ts b/src/n.ts',
    'new file mode 100644',
    'index 0000000..222',
    '--- /dev/null',
    '+++ b/src/n.ts',
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join('\n');
}

function pureRemoveDiff(lines: string[]): string {
  return [
    'diff --git a/src/o.ts b/src/o.ts',
    'deleted file mode 100644',
    'index 111..0000000',
    '--- a/src/o.ts',
    '+++ /dev/null',
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines.map((l) => `-${l}`),
  ].join('\n');
}

export { fullContextDiff, numbered, pureAddDiff, pureRemoveDiff };
