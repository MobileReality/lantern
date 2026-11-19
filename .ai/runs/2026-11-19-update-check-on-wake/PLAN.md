# Plan

Check for updates on wake, unlock and window focus when the last check is over 15 minutes old.

1. `service.ts`: `RECHECK_AFTER_MS`, `wake` and `now` deps, `lastCheckAt`, subscribe in `start()`.
2. `main.ts`: wire `powerMonitor` resume and unlock-screen, and `browser-window-focus`.
3. Tests in `test/updater-service.test.ts` with a fake wake source and clock in `test/helpers/updater-world.ts`.
4. `docs/updates.md`: one sentence.
