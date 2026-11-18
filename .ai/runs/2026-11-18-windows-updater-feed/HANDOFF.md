# Handoff

Plan was unreviewed (unattended). Windows probes `<feed>/RELEASES` and parses the newest `-full.nupkg`; Squirrel gets the feed folder URL with no serverType. Portable zip (no Update.exe one folder above the exe) gets native null, so the release-page fallback runs.
