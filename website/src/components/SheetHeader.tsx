import type { Page } from '../lib/pages';

export function SheetHeader({ page }: { page: Page }) {
  return (
    <header className="sheet-header">
      <span className="sheet-node" aria-hidden="true" />
      <span className="sheet-file">{page.file}</span>
      <span className="sheet-rule" aria-hidden="true" />
    </header>
  );
}
