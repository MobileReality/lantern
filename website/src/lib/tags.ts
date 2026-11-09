export function withoutTags(text: string): string {
  let result = '';
  let copiedTo = 0;
  for (let open = text.indexOf('<'); open !== -1; open = text.indexOf('<', copiedTo)) {
    const close = text.indexOf('>', open + 1);
    if (close === -1) break;
    if (close === open + 1) {
      result += text.slice(copiedTo, close + 1);
      copiedTo = close + 1;
      continue;
    }
    result += text.slice(copiedTo, open);
    copiedTo = close + 1;
  }
  return result + text.slice(copiedTo);
}
