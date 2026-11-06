import { detectRtk } from '../../skills/lantern-delegate/scripts/rtk-detect.mjs';
import type { RtkStatus } from '../shared/rtk';
import { registeredProject } from './agent-request';

const LOGIN_SHELL_MISS_TTL_MS = 30000;

let lastMissAt = 0;

async function rtkStatus(project: unknown, projectPaths: string[], now: () => number = Date.now): Promise<RtkStatus> {
  const registered = registeredProject(project, projectPaths);
  const loginShell = now() - lastMissAt >= LOGIN_SHELL_MISS_TTL_MS;
  const status = await detectRtk({ projectDirs: registered ? [registered] : [], loginShell });
  if (loginShell && !status.found) lastMissAt = now();
  return status;
}

export { rtkStatus };
