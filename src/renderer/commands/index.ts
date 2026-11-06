import { COMMANDS, isCommandId } from '../../shared/commands';
import type { CommandId } from '../../shared/commands';

const handlers = new Map<CommandId, () => void>();

export function registerCommand(id: CommandId, run: () => void): () => void {
  handlers.set(id, run);
  return () => {
    if (handlers.get(id) === run) handlers.delete(id);
  };
}

export function runCommand(id: string): boolean {
  const run = isCommandId(id) ? handlers.get(id) : undefined;
  if (!run) return false;
  run();
  return true;
}

export function availableCommands(): CommandId[] {
  return COMMANDS.filter((c) => handlers.has(c.id)).map((c) => c.id);
}
