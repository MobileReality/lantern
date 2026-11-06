const LAST_C0_CONTROL = 0x1f;
const DELETE = 0x7f;

function isControlCode(code: number): boolean {
  return code <= LAST_C0_CONTROL || code === DELETE;
}

export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isControlCode(text.charCodeAt(i))) return true;
  }
  return false;
}

export function stripControlCharacters(text: string): string {
  let kept = '';
  for (let i = 0; i < text.length; i++) {
    if (!isControlCode(text.charCodeAt(i))) kept += text[i];
  }
  return kept;
}
