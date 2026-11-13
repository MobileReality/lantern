# Handoff

Plan unreviewed (unattended run). uninstall(script, link) added to src/main/cli.ts: removes the link only when it points at script, else returns status untouched; EACCES/EPERM falls back to an administrator prompt via the shared runAsAdmin. Full pnpm test had one timeout in test/install-skills.test.ts under load; passes alone.
