# Handoff

Code, tests, docs done. Remaining: green loop (reviewer), Lantern map, push, PR.

Reviewer follow-ups (non-blocking, not done):
- Move the view, notice and label strings into `src/shared/lang/en/messages.json` (`msg()`); the sibling Memory view also hard-codes its text.
- An async `ipcMain.on` listener that rejects is recorded twice (as `ipc` and as an unhandled rejection).
- The project list used for redaction is cached for 5 s.
- No `before-quit` on a Windows shutdown, so it reads as an unclean exit (now said in the docs).
- The crash notice appears in each window until one of them dismisses it.
- Use the `@shared/diagnostics` alias instead of `../../shared/diagnostics`.
- No test for the `[Bug] Lantern recorded a crash` issue title through `diagnostics:github`.
- Unverified: whether GitHub keeps `body=` when `template=bug_report.md` is also given.

Decisions the brief did not settle:
- `process.on('unhandledRejection')` is listened to (it logs to console like the default warning) so rejections are recorded; uncaught exceptions use `uncaughtExceptionMonitor`, which keeps Electron's default dialog.
- Diagnostics start in `init()` (after the single-instance lock), so a second instance never writes a start marker without a quit marker.
- Crash = a `fatal` entry or a run with a start marker and no quit marker in the previous run.
- The GitHub link is built in main from an entry id; the window never sends a URL.
