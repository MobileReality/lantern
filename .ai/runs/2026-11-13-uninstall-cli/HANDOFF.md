# Handoff

Plan unreviewed (unattended run). Port unchanged: remove/readUserPath/writeUserPath already cover uninstall.
Ownership: Linux link must resolve to ctx.script; Windows shim must carry the lantern-cli-shim marker.
A leftover Lantern PATH entry is dropped even when the shim is already gone.
