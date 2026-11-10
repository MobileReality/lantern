# Diagnostics

Diagnostics is where Lantern keeps its own errors, crashes and editor-server problems, on your computer,
so you can see what went wrong and, if you want, tell us. Open it from the command palette: **Diagnostics**.
If the editor does not start, the failure screen has a **Show diagnostics** link.

## What is recorded

Problems of the app itself, never of your AI assistant: errors in the main process and in its windows,
a window or helper process that crashed or stopped responding, requests from a window that failed, and
the editor (VS Code server): a failed start, a non-zero exit with its last output, error output and a
health check that never got an answer. Nothing from agent sessions, prompts or skill runs is read or stored.

The log is one file in Lantern's user data folder (`diagnostics/events.jsonl`). It keeps at most 2,000 entries,
about 2 MB and 30 days, dropping the oldest first. It stays across restarts, so a crash shows up on the next start.

## What a report contains

The Lantern version, operating system and architecture, Electron and Node versions, and the entry you chose
or the last 30 entries: time, kind, message, exit code and stack. Home folders become `~`, project folders become
`<project>`, and tokens (including the editor connection token) are removed before anything is written or shown.

## Reporting a problem

- **Copy report** puts the redacted text on your clipboard.
- **Report on GitHub** opens a new issue on `github.com/MobileReality/lantern` in your browser with the title and
  report filled in. Read it there, edit it, then submit. Lantern sends nothing itself: no network call is made
  until you press Submit on GitHub, and it never opens the page without your click.
- A long report does not fit in a link. Lantern then puts a short summary in the issue and copies the full report
  to your clipboard: paste it into the issue before you submit.
- After a crash, Lantern shows a notice once, with **Report on GitHub** and **Dismiss**: **Lantern closed unexpectedly last time** when the last run never quit normally, or **Lantern recorded a crash last time** when a window or helper process crashed but Lantern itself quit normally. A Windows shutdown or restart does not give Lantern a chance to log a normal quit, so it can look like an unexpected close.
