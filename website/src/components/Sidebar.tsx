import { tocHeadings } from '../lib/headings';
import { hashFor } from '../lib/links';
import { HOME_ROUTE, PAGES, type Page, SITE_NAME } from '../lib/pages';
import { sheetLabel, sheetNumber } from '../lib/sheets';
import { markdownFor } from '../lib/sources';

type SidebarProps = {
  current: Page | undefined;
  anchor: string;
  open: boolean;
  onToggle: () => void;
};

const MENU_ID = 'site-nav';
const LOGO_PATH = 'logo.png';

export function Sidebar({ current, anchor, open, onToggle }: SidebarProps) {
  return (
    <aside className="sidebar" data-open={open}>
      <div className="sidebar-bar">
        <a className="brand" href={hashFor(HOME_ROUTE)}>
          <span className="brand-mark">
            <img src={`${import.meta.env.BASE_URL}${LOGO_PATH}`} alt="" width="36" height="36" />
          </span>
          <span className="brand-text">
            <span className="brand-name">{SITE_NAME}</span>
            <span className="brand-sub">Documentation</span>
          </span>
        </a>
        <button className="menu-button" type="button" aria-expanded={open} aria-controls={MENU_ID} onClick={onToggle}>
          <span className="menu-icon" aria-hidden="true" />
          {open ? 'Close' : 'Contents'}
        </button>
      </div>
      <nav id={MENU_ID} aria-label="Documentation">
        <p className="nav-caption">Contents</p>
        <ol className="nav-list">
          {PAGES.map((page) => (
            <li key={page.route}>
              <a href={hashFor(page.route)} aria-current={page === current ? 'page' : undefined}>
                <span className="nav-number">{sheetLabel(sheetNumber(page))}</span>
                <span className="nav-label">{page.label}</span>
              </a>
              {page === current && <PageContents page={page} anchor={anchor} />}
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

function PageContents({ page, anchor }: { page: Page; anchor: string }) {
  const headings = tocHeadings(markdownFor(page.file) ?? '').filter((heading) => heading.level === 2);
  if (headings.length === 0) return null;
  const sheet = sheetNumber(page);
  return (
    <ol className="toc" aria-label={`On ${page.label}`}>
      {headings.map((heading, index) => (
        <li key={heading.id}>
          <a href={hashFor(page.route, heading.id)} aria-current={heading.id === anchor ? 'location' : undefined}>
            <span className="toc-number">
              {sheet}.{index + 1}
            </span>
            <span>{heading.text}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}
