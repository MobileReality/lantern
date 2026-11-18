# Handoff

Plan unreviewed (unattended run). Cause is inferred from code, unverified in the real app.
Guest webContents had no navigation guard; unhandled file drop navigates the editor to file://.
Fix: hardenGuestContents in src/main/windows.ts, wired in main.ts, notice via alertUser.
