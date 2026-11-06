import { appleScriptString, osascript } from '../shell';

// Every iTerm2 session knows its tty, which is the tmux client's tty when tmux runs inside it.
async function focus(tty: string): Promise<boolean> {
  const script = `tell application id "com.googlecode.iterm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is ${appleScriptString(tty)} then
          try
            set miniaturized of w to false
          end try
          select s
          select t
          select w
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return ""`;
  return (await osascript(script)) === 'ok';
}

export { focus };
