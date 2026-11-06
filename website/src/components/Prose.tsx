import type { CSSProperties } from 'react';
import type { Page } from '../lib/pages';
import { sheetNumber } from '../lib/sheets';
import { MarkdownPage } from './MarkdownPage';

type ProseProps = { page: Page; source: string; className?: string };

export function Prose({ page, source, className }: ProseProps) {
  const style = { '--sheet': `"${sheetNumber(page)}"` } as CSSProperties;
  return (
    <article className={className ? `prose ${className}` : 'prose'} style={style}>
      <MarkdownPage file={page.file} source={source} />
    </article>
  );
}
