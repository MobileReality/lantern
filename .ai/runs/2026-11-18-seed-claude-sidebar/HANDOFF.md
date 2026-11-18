# Handoff

Plan unreviewed (unattended run). Key seeded in `mergeEditorSettings`, called on every `serveweb.start` through `ensureEditorSettingsFile`.
Known: a settings.json with JSONC comments is left alone by the existing function, so it is not seeded either.
