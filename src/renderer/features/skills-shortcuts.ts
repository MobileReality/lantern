const isTextEntry = (node: EventTarget | null) => node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);

export function searchShortcuts(board: HTMLElement, focusSearch: () => void) {
  const stop = new AbortController();
  document.addEventListener(
    'keydown',
    (event) => {
      if (!board.isConnected) return stop.abort();
      if (board.closest('.hidden')) return;
      const plain = event.key === '/' && !isTextEntry(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey;
      const find = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f';
      if (!plain && !find) return;
      event.preventDefault();
      focusSearch();
    },
    { signal: stop.signal },
  );
}
