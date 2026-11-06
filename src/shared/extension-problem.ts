import { type ExtensionProblem, extraProblem, offProblem } from './extension-slots';
import { type MessageKey, msg } from './lang/messages';

const PROBLEM_MESSAGE: Record<ExtensionProblem, MessageKey> = {
  badName: 'extensions.problem.badName',
  locked: 'extensions.problem.locked',
  duplicate: 'extensions.problem.duplicate',
  notSwitchable: 'extensions.problem.notSwitchable',
};

export function offProblemMessage(names: readonly string[], switchable: readonly string[]): string | null {
  const found = offProblem(names, switchable);
  return found ? msg(PROBLEM_MESSAGE[found.problem], { name: found.name }) : null;
}

export function extraProblemMessage(names: readonly string[], locked: readonly string[]): string | null {
  const found = extraProblem(names, locked);
  return found ? msg(PROBLEM_MESSAGE[found.problem], { name: found.name }) : null;
}
