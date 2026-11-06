import { marked } from 'marked';
import { safeMarkdown } from '../lib/safe-markdown';
import { activeProjectPath } from '../state';
import { baseName, byId, confirmBtn, relTime } from '../lib/util';
import { codeLinesFor, codeRow, langFor, plainCodeLinesFor } from '../lib/codeview';
import { parseExplain, type Explain, type QuizQuestion } from '../lib/explain';
import { EXPLAINS_DIR } from '../../shared/project-data';
import { registerCommand } from '../commands';

const explainModal = byId('explain-modal');
const exProjEl = byId('ex-proj');
const exTitleEl = byId('ex-title');
const exListEl = byId('ex-list');
const exDocEl = byId('ex-doc');

interface Loaded {
  name: string;
  mtime: number;
  parsed: Explain;
}

let exFiles: Loaded[] = [];
let exIndex = 0;
let exCodeTicket = 0;

marked.setOptions({ gfm: true, breaks: false });

function renderExplainList() {
  exListEl.innerHTML = '';
  exFiles.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'fl-file' + (i === exIndex ? ' active' : '');
    const main = document.createElement('span');
    main.className = 'fl-f-main';
    const name = document.createElement('span');
    name.className = 'fl-f-name';
    name.textContent = f.parsed.meta.title || f.name.replace(/\.md$/, '');
    const time = document.createElement('span');
    time.className = 'fl-f-time';
    time.textContent = relTime(f.mtime);
    main.append(name, time);
    row.dataset.tip = f.parsed.meta.summary || '';
    const count = document.createElement('span');
    count.className = 'fl-f-count';
    if (f.parsed.quiz.length) count.textContent = `${f.parsed.quiz.length}?`;
    const del = confirmBtn('×', '✓', () => removeExplain(f.name), 'fl-f-del');
    del.dataset.tip = `Delete ${f.name}`;
    del.setAttribute('aria-label', `Delete ${f.name}`);
    row.append(main, count, del);
    row.addEventListener('click', () => {
      exIndex = i;
      renderExplain();
    });
    exListEl.appendChild(row);
  });
}

function heading(text: string) {
  const h = document.createElement('h2');
  h.className = 'ex-h';
  h.textContent = text;
  return h;
}

function markdownBlock(md: string, cls = 'ex-md') {
  const div = document.createElement('div');
  div.className = cls;
  div.innerHTML = safeMarkdown(md);
  wireLinks(div);
  return div;
}

function wireLinks(container: HTMLElement) {
  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href)) {
      a.addEventListener('click', (e) => e.preventDefault());
      return;
    }
    a.classList.add('ex-ref');
    const [path, symbol] = splitRef(href);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openRef(path, symbol);
    });
  });
}

function splitRef(href: string): [string, string] {
  const i = href.indexOf('#');
  return i >= 0 ? [href.slice(0, i), href.slice(i + 1)] : [href, ''];
}

function renderQuiz(questions: QuizQuestion[]) {
  const wrap = document.createElement('div');
  wrap.className = 'ex-quiz';
  questions.forEach((q, qi) => { wrap.appendChild(quizCard(q, qi)); });
  return wrap;
}

function quizCard(q: QuizQuestion, qi: number) {
  const card = document.createElement('div');
  card.className = 'ex-q';
  const prompt = document.createElement('div');
  prompt.className = 'ex-q-prompt';
  prompt.textContent = `${qi + 1}. ${q.q}`;
  card.appendChild(prompt);
  const opts = document.createElement('div');
  opts.className = 'ex-q-opts';
  for (const opt of shuffle(q.options)) {
    const b = document.createElement('button');
    b.className = 'ex-opt';
    const label = document.createElement('span');
    label.className = 'ex-opt-text';
    label.textContent = opt.text;
    const why = document.createElement('span');
    why.className = 'ex-opt-why';
    why.textContent = opt.why;
    b.append(label, why);
    if (opt.correct) b.dataset.correct = '1';
    b.addEventListener('click', () => answer(card, b));
    opts.appendChild(b);
  }
  card.appendChild(opts);
  return card;
}

function answer(card: HTMLElement, chosen: HTMLElement) {
  if (card.classList.contains('answered')) return;
  card.classList.add('answered');
  const chosenRight = chosen.dataset.correct === '1';
  chosen.classList.add(chosenRight ? 'picked-right' : 'picked-wrong');
  card.querySelectorAll<HTMLElement>('.ex-opt').forEach((b) => {
    b.classList.add('revealed');
    if (b.dataset.correct === '1') b.classList.add('was-right');
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderExplain() {
  exDocEl.scrollTop = 0;
  if (!exFiles.length) {
    exListEl.innerHTML = '';
    exTitleEl.textContent = '';
    exDocEl.innerHTML = `<div class="fl-empty"><div><h3>No explainers</h3>Agents drop <code>.md</code> files into <code>${EXPLAINS_DIR}/</code> to teach a change. None here yet.</div></div>`;
    return;
  }
  renderExplainList();
  const ex = exFiles[exIndex].parsed;
  exTitleEl.textContent = ex.meta.title || exFiles[exIndex].name;
  exDocEl.innerHTML = '';

  if (ex.error) {
    renderExplainError(ex.error);
    return;
  }

  const head = document.createElement('div');
  head.className = 'ex-head';
  const h1 = document.createElement('h1');
  h1.textContent = ex.meta.title;
  const sub = document.createElement('p');
  sub.className = 'ex-sub';
  sub.textContent = ex.meta.summary;
  head.append(h1, sub);
  exDocEl.appendChild(head);

  exDocEl.appendChild(heading('Background'));
  if (ex.primer) {
    const details = document.createElement('details');
    details.className = 'ex-primer';
    const summary = document.createElement('summary');
    summary.textContent = 'Primer — new to this? Start here';
    details.append(summary, markdownBlock(ex.primer));
    exDocEl.appendChild(details);
  }
  if (ex.context) exDocEl.appendChild(markdownBlock(ex.context));

  if (ex.intuition) {
    exDocEl.appendChild(heading('Intuition'));
    exDocEl.appendChild(markdownBlock(ex.intuition));
  }
  if (ex.code) {
    exDocEl.appendChild(heading('Code'));
    exDocEl.appendChild(markdownBlock(ex.code));
  }
  if (ex.quiz.length) {
    exDocEl.appendChild(heading('Check yourself'));
    exDocEl.appendChild(renderQuiz(ex.quiz));
  }
}

function renderExplainError(message: string) {
  exDocEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fl-empty';
  const text = document.createElement('p');
  text.textContent = message;
  box.appendChild(text);
  exDocEl.appendChild(box);
}

const exCodeEl = byId('ex-code');
const exCodePathEl = byId('ex-code-path');
const exCodeBodyEl = byId('ex-code-body');

function closeExplainCode() {
  exCodeTicket++;
  exCodeEl.classList.add('hidden');
  exCodeBodyEl.innerHTML = '';
}

function isFileRef(path: string) {
  return (path.split('/').pop() || '').includes('.');
}

async function openRef(path: string, symbol: string) {
  if (!path || !isFileRef(path)) return;
  exCodeEl.classList.remove('hidden');
  exCodePathEl.textContent = path + (symbol ? `  #${symbol}` : '');
  exCodePathEl.dataset.tip = exCodePathEl.textContent;
  exCodeBodyEl.innerHTML = '<div class="rv-trunc">Loading…</div>';
  const identity = String(++exCodeTicket);
  exCodeBodyEl.dataset.highlightIdentity = identity;
  const project = activeProjectPath();
  if (!project) {
    exCodeBodyEl.innerHTML = '<div class="fl-empty"><div>No project open.</div></div>';
    return;
  }
  const res = await window.ccmws.projectReadFile(project, path);
  if (exCodeBodyEl.dataset.highlightIdentity !== identity) return;
  if (!res.exists) {
    const reason = res.refused ? 'This file lives outside the project, so it cannot be previewed here:' : 'File not found on disk:';
    exCodeBodyEl.innerHTML = `<div class="fl-empty"><div>${reason}<br>${path}</div></div>`;
    return;
  }
  if (res.clipped) {
    exCodeBodyEl.innerHTML = '<div class="fl-empty"><div>File is too large to preview.</div></div>';
    return;
  }
  const paint = ({ html, shown, extra }: Awaited<ReturnType<typeof codeLinesFor>>) => {
    if (exCodeBodyEl.dataset.highlightIdentity !== identity) return;
    exCodeBodyEl.innerHTML = '';
    const rows: { el: HTMLElement; text: string }[] = [];
    html.forEach((lineHtml, i) => { const row = codeRow('ctx', null, i + 1, lineHtml); exCodeBodyEl.appendChild(row); rows.push({ el: row, text: (shown[i] || '').toLowerCase() }); });
    const dropped = extra + (res.truncated || 0);
    if (dropped) { const t = document.createElement('div'); t.className = 'rv-trunc'; t.textContent = `… ${dropped} more lines (truncated for preview)`; exCodeBodyEl.appendChild(t); }
    const hit = symbol && rows.find((r) => r.text.includes(symbol.toLowerCase()));
    if (hit) { hit.el.classList.add('target'); requestAnimationFrame(() => hit.el.scrollIntoView({ block: 'center' })); }
  };
  paint(plainCodeLinesFor(res.text));
  paint(await codeLinesFor(res.text, langFor(path)));
}

async function removeExplain(name: string) {
  const project = activeProjectPath();
  if (!project) return;
  const raw = await window.ccmws.explainsRemove(project, name);
  exFiles = raw.map((f) => ({ name: f.name, mtime: f.mtime, parsed: parseExplain(f.text) }));
  if (exIndex >= exFiles.length) exIndex = Math.max(0, exFiles.length - 1);
  renderExplain();
  window.dispatchEvent(new Event('mr:files-changed'));
}

let unregisterPopout = () => {};

async function openExplain() {
  const project = activeProjectPath();
  explainModal.classList.remove('hidden');
  if (!document.body.classList.contains('popout')) unregisterPopout = registerCommand('explain.popout', popoutExplain);
  closeExplainCode();
  exProjEl.textContent = project ? baseName(project) : '';
  exTitleEl.textContent = '';
  exListEl.innerHTML = '';
  exDocEl.innerHTML = '<div class="fl-empty">Loading…</div>';
  if (!project) {
    exDocEl.innerHTML = '<div class="fl-empty"><div><h3>No project open</h3>Open a project to read its change explainers.</div></div>';
    return;
  }
  const rawExplains = await window.ccmws.explainsList(project);
  exFiles = rawExplains.map((f) => ({ name: f.name, mtime: f.mtime, parsed: parseExplain(f.text) }));
  exIndex = 0;
  renderExplain();
}

function closeExplain() {
  explainModal.classList.add('hidden');
  unregisterPopout();
  closeExplainCode();
}

const explainCard = explainModal.querySelector('.modal-card') as HTMLElement;

byId('ex-close').addEventListener('click', closeExplain);
byId('ex-code-close').addEventListener('click', closeExplainCode);
byId('ex-max').addEventListener('click', () => explainCard.classList.toggle('maximized'));
function popoutExplain() {
  const p = activeProjectPath();
  if (p) window.ccmws.popoutOpen('explain', p);
}

byId('ex-popout').addEventListener('click', popoutExplain);
byId('ex-list-toggle').addEventListener('click', (e) => {
  const collapsed = explainCard.classList.toggle('list-collapsed');
  (e.currentTarget as HTMLElement).textContent = collapsed ? '❯' : '❮';
  (e.currentTarget as HTMLElement).dataset.tip = collapsed ? 'Show list' : 'Hide list';
  (e.currentTarget as HTMLElement).setAttribute('aria-label', collapsed ? 'Show list' : 'Hide list');
});
explainModal.addEventListener('click', (e) => {
  if (e.target === explainModal) closeExplain();
});
document.addEventListener('keydown', (e) => {
  if (explainModal.classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    if (!exCodeEl.classList.contains('hidden')) closeExplainCode();
    else closeExplain();
  }
});

export { openExplain };
