function isSelectingWithin(el: Element) {
  const selection = el.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return el.contains(selection.anchorNode) || el.contains(selection.focusNode);
}

export { isSelectingWithin };
