import { osascript, writeTitle } from '../shell';

const GHOSTTY = 'com.mitchellh.ghostty';
const MARKER_POLLS = 8;
const MARKER_POLL_MS = 60;

// Ghostty 1.3+ scripts its terminals across windows and Spaces but exposes no tty, so a title
// marker written to the tty tells us which terminal is ours. Needs the Automation permission.
async function focus(tty: string): Promise<boolean> {
  const titles = await osascript(`tell application id "${GHOSTTY}"
  set out to ""
  repeat with t in terminals
    set out to out & (id of t) & tab & (name of t) & linefeed
  end repeat
  return out
end tell`);
  if (titles === null) return false;
  const marker = `lantern-${Math.random().toString(36).slice(2, 10)}`;
  if (!writeTitle(tty, marker)) return false;
  const script = `tell application id "${GHOSTTY}"
  repeat with t in terminals
    if (name of t) contains "${marker}" then
      focus t
      activate
      return id of t
    end if
  end repeat
end tell
return ""`;
  for (let i = 0; i < MARKER_POLLS; i++) {
    await new Promise((r) => setTimeout(r, MARKER_POLL_MS));
    const id = await osascript(script);
    if (!id) continue;
    const original = titles.split('\n').find((line) => line.startsWith(`${id}\t`));
    if (original) writeTitle(tty, original.slice(id.length + 1));
    return true;
  }
  return false;
}

export { focus };
