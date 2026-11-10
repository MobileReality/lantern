export interface ProcessActivity {
  terminals: number;
  running: number;
}

export interface ActivityState {
  agentRunning: boolean;
  processes: ProcessActivity | null;
}

export interface LiveParts {
  agentRunning: boolean;
  terminals: number;
  running: number;
  unknown: boolean;
}

export function liveParts(state: ActivityState): LiveParts {
  return {
    agentRunning: state.agentRunning,
    terminals: state.processes?.terminals ?? 0,
    running: state.processes?.running ?? 0,
    unknown: state.processes === null,
  };
}

export function canInstallNow(state: ActivityState): boolean {
  const parts = liveParts(state);
  return !parts.unknown && !parts.agentRunning && parts.terminals === 0 && parts.running === 0;
}
