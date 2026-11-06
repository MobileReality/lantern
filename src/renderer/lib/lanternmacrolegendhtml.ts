import { esc } from './lanternctx';
import { HELP, legendEntries, legendText } from './lanternmacrolegend';
import type { LegendEntry, LegendKind, LegendWhen, Swatch } from './lanternmacrolegend';
import { MACRO_STYLE_CLASSES } from './lanternmacrostyles';

const SWATCH_W = 34;
const PILL_H = 16;
const PILL_CHAR_PX = 7;
const PILL_PAD = 10;

const svgOf = (height: number, inner: string) => `<svg class="mv-swatch" width="${SWATCH_W}" height="${height}" viewBox="0 0 ${SWATCH_W} ${height}" aria-hidden="true" focusable="false">${inner}</svg>`;

function pillSwatch(classes: readonly string[], text: string) {
  const width = Math.min(SWATCH_W - 2, text.length * PILL_CHAR_PX + PILL_PAD);
  const x = (SWATCH_W - width) / 2;
  const inner = `<g class="mv-badge ${classes.join(' ')}"><rect class="mv-badge-bg" x="${x}" y="1" width="${width}" height="${PILL_H}" rx="${PILL_H / 2}"/><text class="mv-badge-text" x="${SWATCH_W / 2}" y="12.5" text-anchor="middle" font-size="11">${esc(text)}</text></g>`;
  return svgOf(PILL_H + 2, inner);
}

function swatchHtml(swatch: Swatch): string {
  switch (swatch.kind) {
    case 'shape':
      return svgOf(18, `<g class="mv-item mv-${swatch.shape} ${swatch.classes.join(' ')}"><rect class="mv-shape" x="2" y="2" width="${SWATCH_W - 4}" height="14" rx="4"/></g>`);
    case 'ribbon':
      return svgOf(14, `<path class="mv-ribbon ${swatch.classes.join(' ')}" d="M3,7 H${SWATCH_W - 3}" stroke-width="${swatch.width}"/>`);
    case 'pill':
      return pillSwatch(swatch.classes, swatch.text);
    case 'chip':
      return `<span class="${MACRO_STYLE_CLASSES.system} mv-swatch-chip" aria-hidden="true"><b class="mv-system-count">3</b></span>`;
    case 'line':
      return `<svg width="${SWATCH_W}" height="10" aria-hidden="true" focusable="false"><path d="M1,5 H${SWATCH_W - 1}" stroke="${swatch.ink}" stroke-width="${swatch.width}" opacity="${swatch.opacity}" fill="none"/></svg>`;
    case 'frame':
      return `<svg width="${SWATCH_W}" height="16" aria-hidden="true" focusable="false"><rect x="1.5" y="2.5" width="${SWATCH_W - 3}" height="11" rx="2" fill="none" stroke="${swatch.ink}" stroke-width="${swatch.width}"/></svg>`;
  }
}

function rowHtml(entry: LegendEntry, minStrongEdge: number) {
  return `<div data-legend="${entry.id}">${swatchHtml(entry.swatch)}<span class="legend-text">${esc(legendText(entry, minStrongEdge))}</span></div>`;
}

function legendHtml(kind: LegendKind, holds: ReadonlySet<LegendWhen>, minStrongEdge: number) {
  const rows = legendEntries(kind, holds).map((entry) => rowHtml(entry, minStrongEdge)).join('');
  const help = HELP[kind].map((line) => `<p>${esc(line)}</p>`).join('');
  return `<h2>How to read it</h2><div class="legend">${rows}${help}</div>`;
}

export { legendHtml, swatchHtml };
