type ReviewMode = 'file' | 'diff';

function prRow(root: ParentNode, path: string) {
  const row = root.querySelector<HTMLElement>(`[data-pr-go="${path}"]`);
  if (!row) throw new Error(`no pull request row for ${path}`);
  return row;
}

function setReviewMode(root: ParentNode, mode: ReviewMode) {
  const button = root.querySelector<HTMLElement>(`.lt-review [data-review-mode="${mode}"]`);
  if (button && button.getAttribute('aria-pressed') !== 'true') button.click();
}

function openPrFile(root: ParentNode, path: string, mode?: ReviewMode) {
  prRow(root, path).click();
  if (mode) setReviewMode(root, mode);
}

export { openPrFile, prRow, setReviewMode };
