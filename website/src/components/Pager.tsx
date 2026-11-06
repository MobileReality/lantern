import { hashFor } from '../lib/links';
import type { Page } from '../lib/pages';
import { neighbours, sheetLabel, sheetNumber } from '../lib/sheets';

export function Pager({ page }: { page: Page }) {
  const { previous, next } = neighbours(page);
  return (
    <nav className="pager" aria-label="Previous and next page">
      {previous ? <PagerLink page={previous} direction="previous" /> : <span />}
      {next ? <PagerLink page={next} direction="next" /> : <span />}
    </nav>
  );
}

function PagerLink({ page, direction }: { page: Page; direction: 'previous' | 'next' }) {
  return (
    <a className={`pager-link pager-${direction}`} href={hashFor(page.route)} rel={direction === 'next' ? 'next' : 'prev'}>
      <span className="pager-meta">
        {direction === 'next' ? 'Next' : 'Previous'} · {sheetLabel(sheetNumber(page))}
      </span>
      <span className="pager-title">{page.label}</span>
    </a>
  );
}
