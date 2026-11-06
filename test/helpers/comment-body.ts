import { codeRow } from '../../src/renderer/lib/codeview';

function fileBody(lines: string[]) {
  const body = document.createElement('div');
  body.className = 'rv-code lt-code-body';
  body.append(...lines.map((text, index) => codeRow('ctx', null, index + 1, text)));
  document.body.appendChild(body);
  return body;
}

function diffBody() {
  const body = document.createElement('div');
  body.className = 'rv-code lt-code-body';
  const hunk = document.createElement('div');
  hunk.className = 'cl hunk';
  hunk.append(...['ln', 'ln', 'code'].map((cls) => Object.assign(document.createElement('span'), { className: cls })));
  body.append(hunk, codeRow('ctx', 1, 1, 'alpha'), codeRow('del', 2, null, 'beta'), codeRow('add', null, 2, 'beta two'), codeRow('add', null, 3, 'beta three'), codeRow('ctx', 3, 4, 'gamma'));
  document.body.appendChild(body);
  return body;
}

function select(body: HTMLElement, from: number, to: number) {
  const codes = [...body.querySelectorAll<HTMLElement>('.cl.ctx .code, .cl.add .code')];
  const first = codes[from - 1];
  const last = codes[to - 1];
  document.getSelection()?.setBaseAndExtent(first, 0, last, last.childNodes.length);
}

export { diffBody, fileBody, select };
