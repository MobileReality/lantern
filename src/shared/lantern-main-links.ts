// Tunable guesses: 80% of the feature-to-feature relation lines, never more than twice as many links as feature blocks.
const MAIN_LINK_COVERAGE = 0.8;
const MAIN_LINK_CAP_FACTOR = 2;
const COVERAGE_TOLERANCE = 1e-9;

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function selectMainLinks(weights: ReadonlyMap<string, number>, nodes: number): Set<string> {
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const cap = MAIN_LINK_CAP_FACTOR * nodes;
  const heaviestFirst = [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const main = new Set<string>();
  let covered = 0;
  for (const [pair, weight] of heaviestFirst) {
    if (main.size >= cap || covered >= total * MAIN_LINK_COVERAGE - COVERAGE_TOLERANCE) break;
    main.add(pair);
    covered += weight;
  }
  return main;
}

export { MAIN_LINK_CAP_FACTOR, MAIN_LINK_COVERAGE, pairKey, selectMainLinks };
