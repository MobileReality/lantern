import { hashFor } from '../lib/links';
import { HOME_ROUTE, PAGES } from '../lib/pages';
import { sheetLabel, sheetNumber } from '../lib/sheets';

export function NotFound({ route }: { route: string }) {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <header className="sheet-header">
        <span className="sheet-node sheet-node-off" aria-hidden="true" />
        <span className="sheet-file">#{route}</span>
        <span className="sheet-rule" aria-hidden="true" />
      </header>
      <svg className="broken-edge" viewBox="0 0 320 60" aria-hidden="true">
        <circle className="node" cx="16" cy="30" r="7" />
        <path className="edge-solid" d="M23,30 H120" />
        <path className="edge-break" d="M128,22 L140,38 M180,22 L192,38" />
        <path className="edge-dashed" d="M200,30 H297" />
        <circle className="node node-unlit" cx="304" cy="30" r="7" />
      </svg>
      <h1 id="not-found-title">No page at this address</h1>
      <p>
        The edge to <code>#{route}</code> leads nowhere: this site has no page there. Pick a page below, or go back
        to the <a href={hashFor(HOME_ROUTE)}>introduction</a>.
      </p>
      <ol className="sheet-index">
        {PAGES.map((page) => (
          <li key={page.route}>
            <a href={hashFor(page.route)}>
              <span className="nav-number">{sheetLabel(sheetNumber(page))}</span>
              <span>{page.label}</span>
              <span className="sheet-index-file">{page.file}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
