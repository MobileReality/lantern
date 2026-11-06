import fs from 'node:fs';
import path from 'node:path';
import type { AgentKind } from './agent';
import { isPlanFixTarget } from '../shared/lantern-plan-fix';

const KINDS = new Set<AgentKind>(['plan-fix', 'lantern', 'lantern-refresh']);

function existingDirectory(value: unknown) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
  try {
    return fs.statSync(value).isDirectory() ? path.resolve(value) : null;
  } catch {
    return null;
  }
}

function registeredProject(value: unknown, projectPaths: string[]) {
  const dir = existingDirectory(value);
  if (!dir) return null;
  return projectPaths.find((p) => path.resolve(p) === dir) || null;
}

function safeAgentRequest(value: unknown, projectPaths: string[]) {
  if (!value || typeof value !== 'object') return null;
  const arg = value as { project?: unknown; kind?: unknown; target?: unknown };
  const project = registeredProject(arg.project, projectPaths);
  if (!project || typeof arg.kind !== 'string' || !KINDS.has(arg.kind as AgentKind)) return null;
  const kind = arg.kind as AgentKind;
  if (kind === 'plan-fix') {
    if (typeof arg.target !== 'string' || !isPlanFixTarget(arg.target)) return null;
  } else if (arg.target !== undefined) {
    return null;
  }
  return { project, kind, target: typeof arg.target === 'string' ? arg.target : undefined };
}

export { registeredProject, safeAgentRequest };
