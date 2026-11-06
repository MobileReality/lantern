import type { SemanticHighlightResult } from '../../shared/code-highlighting';

function limitMessage(result: SemanticHighlightResult | undefined) {
  if (!result || result.ok) return null;
  if (result.reason === 'revision snapshot exceeds the preview safety limit') return 'Semantic highlighting unavailable: this revision exceeds the preview size or file limit.';
  if (result.reason === 'historical semantic snapshot limit reached') return 'Semantic highlighting unavailable: too many historical revisions are open.';
  return null;
}

function semanticLimitNotices(results: Array<SemanticHighlightResult | undefined>) {
  const messages = new Set(results.map(limitMessage).filter((message) => message !== null));
  return [...messages].map((message) => {
    const notice = document.createElement('div');
    notice.className = 'rv-trunc semantic-limit-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = message;
    return notice;
  });
}

export { semanticLimitNotices };
