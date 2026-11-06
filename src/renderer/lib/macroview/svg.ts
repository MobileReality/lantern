import type { Rect } from './camera';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, className = '', attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  parent?.appendChild(node);
  return node;
}

function textEl(className: string, parent: Element, anchor: 'start' | 'middle' | 'end' = 'start') {
  const node = el('text', className, { 'text-anchor': anchor }, parent);
  node.style.display = 'none';
  return node;
}

function showAt(node: SVGElement, shown: boolean) {
  const next = shown ? '' : 'none';
  if (node.style.display !== next) node.style.display = next;
}

function setAttr(node: Element, name: string, value: string | number) {
  const text = String(value);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
}

function setRect(node: SVGRectElement, rect: Rect, radius = 0) {
  setAttr(node, 'x', rect.x);
  setAttr(node, 'y', rect.y);
  setAttr(node, 'width', rect.w);
  setAttr(node, 'height', rect.h);
  if (radius) {
    setAttr(node, 'rx', radius);
    setAttr(node, 'ry', radius);
  }
}

function placeText(node: SVGTextElement, text: string | null, x: number, y: number, size: number, opacity = 1) {
  if (text === null || opacity <= 0.01) return showAt(node, false);
  showAt(node, true);
  setAttr(node, 'x', x);
  setAttr(node, 'y', y);
  setAttr(node, 'font-size', size);
  setAttr(node, 'opacity', Math.round(opacity * 100) / 100);
  if (node.textContent !== text) node.textContent = text;
}

function setFlag(node: Element, name: string, on: boolean) {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

export { SVG_NS, el, placeText, setAttr, setFlag, setRect, showAt, textEl };
