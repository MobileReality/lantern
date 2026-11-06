import os from 'node:os';
import path from 'node:path';

const DEV_PROFILE = process.env.LANTERN_PROFILE === 'dev';
const PORT = DEV_PROFILE ? 0 : 31337;
// LANTERN_NOTIFICATIONS=0 silences cards and OS notifications for this run, =1 forces them on;
// unset, the dev profile is silent (an installed Lantern beside it already shows them).
const NOTIFICATIONS_OFF = process.env.LANTERN_NOTIFICATIONS === '0' || (DEV_PROFILE && process.env.LANTERN_NOTIFICATIONS !== '1');

// Markers used only to remove hook groups installed by older Lantern builds.
const ENDPOINT = `http://127.0.0.1:${PORT}/event`;

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export { DEV_PROFILE, NOTIFICATIONS_OFF, PORT, ENDPOINT, SETTINGS_PATH };
