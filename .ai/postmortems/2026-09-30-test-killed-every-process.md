---
symptom: all of the user's apps closed while a delegate ran the test suite
gap: control, feedback
rejected: context, access
---

**Rescue:** the user noticed every app closing, twice; I grepped the delegate's transcript (no kill commands), then its test file: a mocked child with `pid = 1` plus `afterEach(agent.cancel)`, and `cancel()` runs `process.kill(-pid, 'SIGKILL')`, i.e. `kill(-1)`.

**Control (code)** — `cancel()` signalled any pid it was handed, including 1.
→ `pid > 1` guard in `src/main/agent.ts` with a regression test that stubs `process.kill` first. PR feat/lantern-bundled-skill-language.

**Feedback / control (suite)** — nothing stopped a test from signalling processes it did not spawn, so a green-looking mock could take down the whole session; the reviewer never runs before the delegate's own test run.
→ `installProcessGuard` applied to `process` for every test (`test/setup-process-guard.ts`); pids 0, 1, -1 and non-integers throw. PR fix/test-process-kill-guard.

**Rescue repeated:** the first close-down was read as "session ended" and the delegate was resumed, which re-ran the tests. → memory note, and a rule for me: grep a delegate's tests for `pid` and `kill` before resuming it after a machine-wide close.

**Context rejected** — `agent.ts` is one read away; a prose rule is the wrong form for a hazard a command can block.
**Access rejected** — nothing was out of reach.
**Cross-repo pattern** → unfixed — skills library: `delegate-protocol` should tell delegates never to fake real pids or signal foreign processes.

**Proof:** guard unit tests fail if the throw is removed; the regression test for `cancel()` failed with the guard line removed and passes with it. The exact shipped scenario was not re-run unguarded, on purpose.
