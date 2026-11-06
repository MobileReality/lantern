import { type MouseEvent, useEffect, useState } from 'react';
import { NotFound } from './components/NotFound';
import { Pager } from './components/Pager';
import { Prose } from './components/Prose';
import { SheetHeader } from './components/SheetHeader';
import { Sidebar } from './components/Sidebar';
import { hashFor, parseHash } from './lib/links';
import { findPageByRoute, pageTitle, SITE_TITLE } from './lib/pages';
import { markdownFor } from './lib/sources';
import { useHash } from './lib/useHash';

const TARGET_ATTRIBUTE = 'data-target';

function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById('content')?.focus();
}

export function App() {
  const hash = useHash();
  const { route, anchor } = parseHash(hash);
  const page = findPageByRoute(route);
  const source = page ? markdownFor(page.file) : undefined;
  const [menuState, setMenuState] = useState({ open: false, hash });

  const menuOpen = menuState.open && menuState.hash === hash;

  useEffect(() => {
    document.title = page ? pageTitle(page) : `Not found · ${SITE_TITLE}`;
  }, [page]);

  useEffect(() => {
    const target = anchor ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    target?.setAttribute(TARGET_ATTRIBUTE, '');
    return () => target?.removeAttribute(TARGET_ATTRIBUTE);
  }, [route, anchor]);

  return (
    <div className="shell">
      <a className="skip-link" href={hashFor(route, anchor)} onClick={skipToContent}>
        Skip to content
      </a>
      <Sidebar current={page} anchor={anchor} open={menuOpen} onToggle={() => setMenuState({ open: !menuOpen, hash })} />
      <main id="content" tabIndex={-1} className="main">
        {page && source !== undefined ? (
          <>
            <SheetHeader page={page} />
            <Prose page={page} source={source} />
          </>
        ) : (
          <NotFound route={route} />
        )}
        {page && <Pager page={page} />}
        <footer className="site-footer">
          <span>This site renders the Markdown files of the Lantern repository.</span>
          {page && <span className="site-footer-file">Source: {page.file}</span>}
          <p className="site-footer-legal">Lantern is released under the MIT License. Copyright (c) 2026 Mobile Reality.</p>
          <p className="site-footer-legal">Lantern is not affiliated with or endorsed by Anthropic, OpenAI, Microsoft, Atlassian or GitHub; their names and marks are trademarks of their owners.</p>
        </footer>
      </main>
    </div>
  );
}
