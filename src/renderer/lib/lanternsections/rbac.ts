import type { RbacCell, RbacEntry, RbacSection } from '../../../main/lantern';
import { esc } from '../lanternctx';
import { citesHtml, noteHtml } from './common';
import type { Renderer, SectionCtx } from './common';

const GLYPH: Record<RbacCell['access'], string> = { allow: '✓', deny: '✕', cond: '?' };
const WORD: Record<RbacCell['access'], string> = { allow: 'allowed', deny: 'denied', cond: 'only if' };

function head(ctx: SectionCtx, kind: string, entry: RbacEntry) {
  return `<span class="sx-id">${esc(entry.id)}</span>${noteHtml(ctx, `${kind} ${entry.id}`, entry.text)}${citesHtml(ctx, entry.cites)}`;
}

function cellHtml(ctx: SectionCtx, cell: RbacCell | undefined) {
  if (!cell) return '<td class="sx-none">not recorded</td>';
  const hint = cell.text ? ` data-tip="${esc(cell.text)}"` : '';
  return (
    `<td><span class="sx-cell ${cell.access}"${hint}><i aria-hidden="true">${GLYPH[cell.access]}</i>${WORD[cell.access]}</span>` +
    `${noteHtml(ctx, `cell ${cell.role} ${cell.resource}`, cell.text)}${citesHtml(ctx, cell.cites)}</td>`
  );
}

function matrix(ctx: SectionCtx, sec: RbacSection) {
  if (!sec.roles.length || !sec.resources.length) return '';
  const cells = new Map(sec.cells.map((c) => [`${c.role} ${c.resource}`, c]));
  const cols = sec.resources.map((r) => `<th scope="col">${head(ctx, 'res', r)}</th>`).join('');
  const rows = sec.roles.map((role) => `<tr><th scope="row">${head(ctx, 'role', role)}</th>${sec.resources.map((res) => cellHtml(ctx, cells.get(`${role.id} ${res.id}`))).join('')}</tr>`).join('');
  return `<h3>Who may do what</h3><div class="sx-table-wrap"><table class="sx-table sx-matrix"><thead><tr><th scope="col" class="sx-note">role ╲ area</th>${cols}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function list(ctx: SectionCtx, title: string, kind: string, entries: RbacEntry[]) {
  if (!entries.length) return '';
  const rows = entries.map((e) => `<li><span class="sx-id">${esc(e.id)}</span><div>${noteHtml(ctx, `${kind} ${e.id}`, e.text)}${citesHtml(ctx, e.cites)}</div></li>`).join('');
  return `<h3>${title}</h3><ul class="sx-list">${rows}</ul>`;
}

const rbacRenderer: Renderer<RbacSection> = {
  label: 'RBAC',
  noun: 'roles',
  count: (sec) => sec.roles.length,
  body: (ctx, sec) => matrix(ctx, sec) + list(ctx, 'How a role is decided', 'source', sec.sources) + list(ctx, 'Where it is enforced', 'guard', sec.guards),
};

export { rbacRenderer };
