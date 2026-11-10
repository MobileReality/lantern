import { mountLanternView } from '../../../src/renderer/lib/lanternview';
import { graphFixtures } from '../../fixtures/graph/graph-fixtures';
import type { GraphFixtureName } from '../../fixtures/graph/graph-fixtures';
import { AREAS_PR_ID, areasPrDemo, readAreasFile, readAreasPrDiff, readAreasPrFile } from '../../fixtures/graph/areas-pr-demo';
import { MACRO_LAB_PR_ID, macroLabDemo, macroLabPayload } from '../../fixtures/graph/macro-lab-demo';
import { MACRO_SIZED_PR_ID, macroSized } from '../../fixtures/graph/macro-sized-demo';
import { macroSizeDemo } from '../../fixtures/graph/macro-sizes-demo';
import { PR_ID, prReviewDemo, readDemoFile, readDemoPrDiff, readDemoPrFile, readDemoPrOverlay, richFlow } from '../../fixtures/graph/pr-review-demo';

import macroView from '../../fixtures/lantern-macro-own-view.json';
import featureTexts from '../../../.lantern/lang/en/features.json';
import type { MacroView } from '../../../src/main/lantern-macro';
import type { MacroLoad } from '../../../src/main/lantern-macro-load';
import areasPayload from '../../fixtures/lantern-macro-areas-payload.json';

type MacroPayload = Omit<Extract<MacroLoad, { ok: true }>, 'ok'>;

const MIN_STRONG_EDGE = Math.min(...macroView.edges.filter((edge) => edge.strong).map((edge) => edge.count));

declare const __LANTERN_REAL_MAP__: import('../../../src/main/lantern').LanternMap | null;

const params = new URLSearchParams(location.search);
const fixtureName = (params.get('fixture') ?? 'overview') as GraphFixtureName | 'pr-review' | 'areas-pr' | 'macro-lab' | 'macro-lab-small' | 'macro-lab-large' | 'macro-sized' | 'real';
const isPrReview = fixtureName === 'pr-review';
const isAreasPr = fixtureName === 'areas-pr';
const isMacroLab = fixtureName === 'macro-lab';
const isMacroSized = fixtureName === 'macro-sized';
const sizeFixtures = { 'macro-lab-small': 'small', 'macro-lab-large': 'large' } as const;
const macroSize = fixtureName in sizeFixtures ? macroSizeDemo(sizeFixtures[fixtureName as keyof typeof sizeFixtures]) : null;
const sized = isMacroSized ? macroSized(Number(params.get('areas') ?? 4), Number(params.get('features') ?? 8)) : null;
const prReviewMap = params.get('flow') === 'rich' ? { ...prReviewDemo, prs: prReviewDemo.prs.map((one) => ({ ...one, flow: richFlow })) } : prReviewDemo;
const fixture = fixtureName === 'real' ? (__LANTERN_REAL_MAP__ ?? graphFixtures.overview) : isPrReview ? prReviewMap : isAreasPr ? areasPrDemo : isMacroLab ? macroLabDemo : sized ? sized.map : macroSize ? macroSize.map : graphFixtures[fixtureName as GraphFixtureName];
const root = document.querySelector('#graph-harness');

if (!(root instanceof HTMLElement)) throw new Error('Graph harness root is missing');

document.documentElement.dataset.graphDprMode = params.get('dprMode') ?? 'native';
if (isPrReview) document.title = 'Lantern — PR review demo';

const DEMO_EXPLANATION = {
  text: 'demo',
  sections: {
    summary: 'The order summary now shows the total with tax. This saves a second lookup.',
    before: 'It showed only the net price.',
    after: 'It shows the net price and the gross total.',
    example: 'net 100, tax 23 -> total 123',
  },
  head: 'a'.repeat(40),
  at: 1,
  stale: false,
};

const demoExplainClient = {
  saved: async () => ({ ok: true as const, explanation: DEMO_EXPLANATION }),
  start: async () => ({ ok: true as const }),
  cancel: async () => true,
  onDone: () => () => {},
};

async function bootstrap() {
  document.documentElement.dataset.graphStartedAt = String(performance.now());
  mountLanternView(root as HTMLElement, fixture, {
    ...(params.get('pr') || isPrReview ? { pr: params.get('pr') || PR_ID } : isAreasPr ? { pr: AREAS_PR_ID } : isMacroLab ? { pr: MACRO_LAB_PR_ID } : isMacroSized ? { pr: MACRO_SIZED_PR_ID } : {}),
    platform: params.get('platform') ?? '',
    ...(params.get('project') ? { project: params.get('project') as string } : {}),
    ...(sized ? { readMacro: async () => ({ ok: true as const, ...sized.payload }) } : macroSize ? { readMacro: async () => ({ ok: true as const, ...macroSize.payload }) } : isMacroLab ? { readMacro: async () => ({ ok: true as const, ...macroLabPayload }) } : params.get('macro') === 'areas' ? { readMacro: async () => ({ ok: true as const, ...(areasPayload as unknown as MacroPayload) }) } : params.get('macro') ? { readMacro: async () => ({ ok: true as const, view: macroView as MacroView, texts: featureTexts.text, blockByPath: {}, systemsByPath: {}, minStrongEdge: MIN_STRONG_EDGE }) } : {}),
    ...(isPrReview && params.get('explain') ? { explain: demoExplainClient } : {}),
    ...(isPrReview ? { readFile: readDemoFile, readPrFile: readDemoPrFile, readPrDiff: readDemoPrDiff, readPrOverlay: readDemoPrOverlay } : {}),
    ...(isAreasPr || isMacroLab || isMacroSized ? { readFile: readAreasFile, readPrFile: readAreasPrFile, readPrDiff: readAreasPrDiff } : {}),
  });
  if (isPrReview) {
    root?.querySelector<HTMLButtonElement>('[data-pr-go="src/checkout/order-summary.tsx"]')?.click();
    root?.querySelector<HTMLButtonElement>('.lt-review [data-review-mode="diff"]')?.click();
  }
}

void bootstrap();
