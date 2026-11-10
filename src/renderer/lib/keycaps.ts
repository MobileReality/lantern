import { el } from './util';

function keyCaps(chips: readonly string[], plus = false) {
  const keys = el('span', 'lt-keys');
  keys.setAttribute('aria-hidden', 'true');
  chips.forEach((chip, n) => {
    if (n > 0 && plus) keys.append(el('span', 'lt-key-sep', '+'));
    keys.append(el('kbd', 'lt-key', chip));
  });
  return keys;
}

export { keyCaps };
