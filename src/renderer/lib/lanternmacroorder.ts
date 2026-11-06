import type { GraphBlock, MacroGraph } from './lanternmacro';

const MAX_SWAP_PASSES = 40;

interface Tie {
  a: string;
  b: string;
  weight: number;
}

function tiesOf(graph: MacroGraph): Tie[] {
  const weights = new Map<string, Tie>();
  for (const edge of graph.edges) {
    const [a, b] = edge.fromKey < edge.toKey ? [edge.fromKey, edge.toKey] : [edge.toKey, edge.fromKey];
    const tie = weights.get(`${a}|${b}`) ?? { a, b, weight: 0 };
    tie.weight += edge.count;
    weights.set(`${a}|${b}`, tie);
  }
  return [...weights.values()];
}

function distanceCost(row: readonly string[], ties: readonly Tie[]) {
  const at = new Map(row.map((key, index) => [key, index]));
  return ties.reduce((sum, tie) => {
    const a = at.get(tie.a);
    const b = at.get(tie.b);
    return a === undefined || b === undefined ? sum : sum + tie.weight * Math.abs(a - b);
  }, 0);
}

function weightTo(key: string, others: ReadonlySet<string>, ties: readonly Tie[]) {
  return ties.reduce((sum, tie) => (tie.a === key && others.has(tie.b)) || (tie.b === key && others.has(tie.a)) ? sum + tie.weight : sum, 0);
}

function insertCheapest(row: string[], key: string, ties: readonly Tie[]) {
  let best = { index: row.length, cost: Infinity };
  for (let index = 0; index <= row.length; index += 1) {
    const cost = distanceCost([...row.slice(0, index), key, ...row.slice(index)], ties);
    if (cost < best.cost) best = { index, cost };
  }
  row.splice(best.index, 0, key);
}

function swapUntilStable(row: string[], ties: readonly Tie[]) {
  let cost = distanceCost(row, ties);
  for (let pass = 0; pass < MAX_SWAP_PASSES; pass += 1) {
    let improved = false;
    for (let i = 0; i < row.length; i += 1) {
      for (let j = i + 1; j < row.length; j += 1) {
        [row[i], row[j]] = [row[j], row[i]];
        const next = distanceCost(row, ties);
        if (next < cost) {
          cost = next;
          improved = true;
        } else [row[i], row[j]] = [row[j], row[i]];
      }
    }
    if (!improved) return;
  }
}

function orderKeys(graph: MacroGraph): string[] {
  const ties = tiesOf(graph);
  const everyone = new Set(graph.blocks.map((block) => block.key));
  const degree = new Map(graph.blocks.map((block) => [block.key, weightTo(block.key, everyone, ties)]));
  const pending = graph.blocks.map((block) => block.key).sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b));
  const row = pending.splice(0, 1);
  while (pending.length) {
    const placed = new Set(row);
    pending.sort((a, b) => weightTo(b, placed, ties) - weightTo(a, placed, ties) || (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b));
    insertCheapest(row, pending.splice(0, 1)[0], ties);
  }
  swapUntilStable(row, ties);
  return row;
}

function ofKind(graph: MacroGraph, kind: GraphBlock['kind']): MacroGraph {
  const blocks = graph.blocks.filter((block) => block.kind === kind);
  const keys = new Set(blocks.map((block) => block.key));
  return { ...graph, blocks, edges: graph.edges.filter((edge) => keys.has(edge.fromKey) && keys.has(edge.toKey)) };
}

function keysOfKind(graph: MacroGraph, kind: GraphBlock['kind']) {
  return graph.blocks.filter((block) => block.kind === kind).map((block) => block.key);
}

function macroRowOrder(graph: MacroGraph) {
  const features = graph.level === 'areas' ? keysOfKind(graph, 'feature') : orderKeys(ofKind(graph, 'feature'));
  return { features, foundation: orderKeys(ofKind(graph, 'core')), stubs: keysOfKind(graph, 'stub') };
}

export { macroRowOrder };
