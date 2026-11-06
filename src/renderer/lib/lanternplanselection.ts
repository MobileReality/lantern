interface SelectedText {
  text: string;
  nth: number;
}

function occurrences(haystack: string, needle: string) {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) found.push(at);
  return found;
}

function pointAt(root: HTMLElement, wanted: number, after: boolean): { node: Node; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (after ? wanted < seen + length : wanted <= seen + length) return { node, offset: wanted - seen };
    seen += length;
  }
  return null;
}

function offsetOf(root: HTMLElement, node: Node, offset: number) {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function saveSelection(root: HTMLElement): SelectedText | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return null;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const text = selection.getRangeAt(0).toString();
  const start = Math.min(offsetOf(root, selection.anchorNode, selection.anchorOffset), offsetOf(root, selection.focusNode, selection.focusOffset));
  const nth = occurrences(root.textContent ?? '', text).indexOf(start);
  return text && nth >= 0 ? { text, nth } : null;
}

function restoreSelection(root: HTMLElement, saved: SelectedText) {
  const start = occurrences(root.textContent ?? '', saved.text)[saved.nth];
  if (start === undefined) return;
  const from = pointAt(root, start, true);
  const to = pointAt(root, start + saved.text.length, false);
  if (from && to) root.ownerDocument.getSelection()?.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

export { restoreSelection, saveSelection };
export type { SelectedText };
