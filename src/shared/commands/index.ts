import {
  DIAGNOSTICS_COMMANDS,
  EDITOR_COMMANDS,
  EXPLAIN_COMMANDS,
  INTEGRATIONS_COMMANDS,
  LANTERN_COMMANDS,
  MEMORY_COMMANDS,
  PALETTE_COMMANDS,
  PROJECT_COMMANDS,
  SETTINGS_COMMANDS,
  SKILLS_COMMANDS,
} from './nodes';
import { isDispatchableKey } from './key-syntax';

export interface CommandSchema {
  title: string;
  keys?: string;
  menu?: boolean;
}

export interface CommandsNode {
  id: string;
  title: string;
  commands: Record<string, CommandSchema>;
}

const COMMAND_NODES = [
  PALETTE_COMMANDS,
  SETTINGS_COMMANDS,
  PROJECT_COMMANDS,
  EDITOR_COMMANDS,
  LANTERN_COMMANDS,
  EXPLAIN_COMMANDS,
  MEMORY_COMMANDS,
  DIAGNOSTICS_COMMANDS,
  INTEGRATIONS_COMMANDS,
  SKILLS_COMMANDS,
] as const;

type NodeCommandIds<N> = N extends { commands: infer C } ? keyof C : never;

export type CommandId = NodeCommandIds<(typeof COMMAND_NODES)[number]> & string;

export interface RegisteredCommand<I extends string = CommandId> {
  id: I;
  schema: CommandSchema;
  category: string;
}

export function registerCommandNodes(nodes: readonly CommandsNode[]): RegisteredCommand<string>[] {
  const seen = new Set<string>();
  const commands: RegisteredCommand<string>[] = [];
  for (const node of nodes) {
    for (const [id, schema] of Object.entries(node.commands)) {
      if (!id.trim()) throw new Error(`Commands node "${node.id}" declares an empty id`);
      if (id !== id.trim()) throw new Error(`Command "${id}" has surrounding whitespace`);
      if (!id.startsWith(`${node.id}.`)) throw new Error(`Command "${id}" must start with "${node.id}."`);
      if (seen.has(id)) throw new Error(`Command "${id}" is declared twice`);
      if (schema.keys !== undefined && !isDispatchableKey(schema.keys)) {
        throw new Error(`Command "${id}" default key "${schema.keys}" needs mod or an F-key`);
      }
      seen.add(id);
      commands.push({ id, schema, category: node.title });
    }
  }
  return commands;
}

export const COMMANDS = registerCommandNodes(COMMAND_NODES) as readonly RegisteredCommand[];

const COMMANDS_BY_ID = new Map(COMMANDS.map((c) => [c.id as string, c]));

export function isCommandId(id: unknown): id is CommandId {
  return typeof id === 'string' && COMMANDS_BY_ID.has(id);
}

export function commandTitle(id: CommandId): string {
  const command = COMMANDS_BY_ID.get(id);
  if (!command) throw new Error(`Unknown command "${id}"`);
  return `${command.category}: ${command.schema.title}`;
}
