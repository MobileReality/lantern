# Handoff

Root cause confirmed: the Skill linker tab wrote `skillLinker` to lantern-extensions.json while `skills.ts` read only the repo from ccm-skills.json, so `listFor` returned `installed: false` with a linker set.

Done: `skills.ts` falls back to the linker's repo (never written, never published as SKILLS_REPO); saved repo wins. Skills window: linker row on the first screen, not-installed marking, attach-and-link, Link to project, plain-word linker status.

Next: reviewer round, Lantern map, push, PR.
