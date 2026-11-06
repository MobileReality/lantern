const PLAN_WINDOW_CLASS = 'plan-window';

const planning = new Map<string, HTMLElement>();

function isShown(root: HTMLElement) {
  return root.isConnected && !root.closest('.hidden, [hidden]');
}

function syncPlanWindow() {
  const on = [...planning.values()].some(isShown);
  document.body.classList.toggle(PLAN_WINDOW_CLASS, on);
}

function holdPlanWindow(owner: string, root: HTMLElement | null) {
  if (root) planning.set(owner, root);
  else planning.delete(owner);
  syncPlanWindow();
}

export { PLAN_WINDOW_CLASS, holdPlanWindow, syncPlanWindow };
