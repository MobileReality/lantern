# Handoff

Code, tests, docs done. Remaining: green loop (reviewer), Lantern map, push, PR.

Decisions the brief did not settle:
- `process.on('unhandledRejection')` is listened to (it logs to console like the default warning) so rejections are recorded; uncaught exceptions use `uncaughtExceptionMonitor`, which keeps Electron's default dialog.
- Diagnostics start in `init()` (after the single-instance lock), so a second instance never writes a start marker without a quit marker.
- Crash = a `fatal` entry or a run with a start marker and no quit marker in the previous run.
- The GitHub link is built in main from an entry id; the window never sends a URL.
