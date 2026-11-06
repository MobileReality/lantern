import type { PrExplainDone } from '../../shared/pr-explain';
import type { PrExplainClient } from './prexplain';

type DoneListener = (done: PrExplainDone) => void;

const listeners = new Set<DoneListener>();
let subscribed = false;

// The preload offers no way to unsubscribe, so one bridge listener fans out to every mounted view.
function subscribeOnce() {
  if (subscribed) return;
  subscribed = true;
  window.ccmws.onPrExplainDone((done) => {
    for (const listener of listeners) listener(done);
  });
}

function projectExplainClient(project: string): PrExplainClient {
  return {
    saved: (pr, path, head) => window.ccmws.prExplainSaved(project, pr, path, head),
    start: (pr, path) => window.ccmws.prExplainStart(project, pr, path),
    cancel: (pr, path) => window.ccmws.prExplainCancel(project, pr, path),
    onDone(cb) {
      subscribeOnce();
      const listener: DoneListener = (done) => {
        if (done.project === project) cb(done);
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export { projectExplainClient };
