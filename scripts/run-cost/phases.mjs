import { REVIEWER_AGENT_TYPES } from '../../skills/lantern-delegate/scripts/delegate-kinds.mjs';
import { isSkillLinkerWord } from '../../skills/lantern-delegate/scripts/skill-linker.mjs';

export const PHASES = ['brief', 'work', 'review', 'handover'];

export const isReviewerType = (agentType) => REVIEWER_AGENT_TYPES.includes(agentType);

const NEUTRAL = 'neutral';
const PRECEDENCE = ['review', 'handover', 'work'];

const NEUTRAL_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Skill', 'ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'ExitPlanMode', 'AskUserQuestion', 'SendMessage']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const SPAWN_TOOLS = new Set(['Agent', 'Task']);

const HANDOVER_PATH = /(^|\/)(\.lantern|\.ai\/tmp)(\/|$)/;
const HANDOVER_COMMAND = /\bgit\s+push\b|pr-create\.mjs|sync\.mjs|lantern-setup\/scripts|pr-append-cost|build-report\.mjs|\bgit\s+add\b[^\n]*(\.lantern|\.ai\/tmp)|\bgit\s+rm\b[^\n]*\.ai\/runs|Lantern map|record pull request|remove the run folder/i;
const NEUTRAL_COMMAND = /^\s*(git\s+(fetch|reset|log|show|status|diff|branch|worktree|rev-parse|config|ls-remote|remote|check-ignore|add|commit|rm)\b|(pnpm|npm|yarn)\s+(install|i)\b|ls\b|cat\b|pwd\b|ln\b|mkdir\b|find\b|grep\b|rg\b|echo\b|which\b|head\b|tail\b|wc\b)/;

function classifyPath(pathValue, otherwise) {
  return HANDOVER_PATH.test(String(pathValue ?? '')) ? 'handover' : otherwise;
}

function classifyBash(command, linker) {
  const text = String(command ?? '');
  if (HANDOVER_COMMAND.test(text)) return 'handover';
  const parts = text.split(/&&|\|\||[;|\n]/).filter((part) => part.trim() !== '');
  return parts.length > 0 && parts.every((part) => NEUTRAL_COMMAND.test(part) || isSkillLinkerWord(part.trim().split(/\s+/)[0], linker)) ? NEUTRAL : 'work';
}

export function classifyTool(tool, linker) {
  const { name, input } = tool;
  if (SPAWN_TOOLS.has(name)) return isReviewerType(input?.subagent_type) ? 'review' : 'work';
  if (name === 'SubagentHandback') return 'handover';
  if (name === 'Bash') return classifyBash(input?.command, linker);
  if (EDIT_TOOLS.has(name)) return classifyPath(input?.file_path ?? input?.notebook_path, 'work');
  if (name === 'Read') return classifyPath(input?.file_path, NEUTRAL);
  if (name === 'Grep' || name === 'Glob') return classifyPath(input?.path ?? input?.pattern, NEUTRAL);
  return NEUTRAL_TOOLS.has(name) ? NEUTRAL : 'work';
}

export function classifyCall(tools, linker) {
  const classes = tools.map((tool) => classifyTool(tool, linker));
  return PRECEDENCE.find((phase) => classes.includes(phase)) ?? NEUTRAL;
}

export function assignPhases(agentType, calls, linker) {
  if (isReviewerType(agentType)) return calls.map(() => 'review');
  let current = 'brief';
  return calls.map((call) => {
    const phase = classifyCall(call.tools, linker);
    if (phase !== NEUTRAL) current = phase;
    return current;
  });
}
