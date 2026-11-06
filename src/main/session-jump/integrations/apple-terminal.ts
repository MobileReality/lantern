import { appleScriptString, osascript } from '../shell';

async function focus(tty: string): Promise<boolean> {
  const script = `tell application id "com.apple.Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is ${appleScriptString(tty)} then
        set miniaturized of w to false
        set selected of t to true
        set index of w to 1
        activate
        return "ok"
      end if
    end repeat
  end repeat
end tell
return ""`;
  return (await osascript(script)) === 'ok';
}

export { focus };
