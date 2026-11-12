# Handoff

Root cause confirmed: the Skill linker tab wrote `skillLinker` to lantern-extensions.json while `skills.ts` read only the repo from ccm-skills.json, so `listFor` returned `installed: false` with a linker set.

Done: `skills.ts` falls back to the linker's repo (never written, never published as SKILLS_REPO); saved repo wins. Skills window: linker row on the first screen, not-installed marking, attach-and-link, Link to project, plain-word linker status.

Review: VERDICT merge-with-followups, BLOCKING 0. Follow-ups:
1. env mismatch for SKILL_LINKER between linkerRepo and linkerState (fixed after the verdict, unreviewed).
2. test isolation from SKILL_LINKER (fixed after the verdict, unreviewed).
3. catalogueSummary walks the linker repo synchronously on every panel load; cache by root if repos grow.
4. sync() now fetches in the linker's own repo through the Skills repo settings.
5. new skillsExtras keys exist only in English.
