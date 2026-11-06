import path from 'node:path';
import { NOTIFICATION_KINDS, type NotificationKind } from '../shared/settings-notifications';
import { readBranch } from './projectroot';
import { describeNotice, type Entry } from './session-context';
import type { NoticeKind, SessionNotice } from './state';

type CardKind = NotificationKind;

interface NotificationCard {
  id: string;
  kind: CardKind;
  title: string;
  context: string;
  cwd: string;
  sessionId: string;
  repoName: string;
  branch: string;
}

interface TransitionNotice {
  kind: NoticeKind;
  session: Pick<SessionNotice['session'], 'id' | 'sessionId' | 'state' | 'updatedAt' | 'cwd' | 'project'>;
}

const CARD_FOR_NOTICE: Record<NoticeKind, { kind: CardKind; title: string; context: string }> = {
  finished: { kind: 'done', title: 'Claude is done', context: 'Finished — waiting for your reply' },
  waiting: { kind: 'waiting', title: 'Claude is waiting for you', context: 'Waiting for your reply' },
  permission: { kind: 'permission', title: 'Claude needs your permission', context: 'Approve or deny the request in the terminal' },
  failed: { kind: 'error', title: 'Claude session failed', context: 'The session stopped with an error' },
};

const CARD_KINDS: readonly CardKind[] = NOTIFICATION_KINDS;

const SAMPLES: Record<CardKind, { label: string; title: string; context: string }> = {
  done: { label: 'Done', title: 'Claude is done', context: 'Moved the notification settings into the registry and added a sound preview. All 1747 tests pass.' },
  waiting: { label: 'Waiting for you', title: 'Claude is asking you', context: 'Should queued cards play their sound when they arrive, or when they reach the front?' },
  permission: { label: 'Needs permission', title: 'Run a shell command?', context: 'Install dependencies: pnpm install --frozen-lockfile' },
  error: { label: 'Failed', title: 'Claude session failed', context: 'The build failed: esbuild could not resolve ./lib/overlay-cards from src/renderer/overlay.ts.' },
};

function sampleCard(kind: CardKind): NotificationCard {
  const { title, context } = SAMPLES[kind];
  return { id: `test-${kind}-${Date.now()}`, kind, title, context, cwd: '', sessionId: '', repoName: 'lantern', branch: 'feat/boopr-notifications' };
}

function sampleLabel(kind: CardKind): string {
  return SAMPLES[kind].label;
}

function deliverTransitionCard(
  notice: TransitionNotice,
  enabled: boolean,
  show: (card: NotificationCard) => void,
  rootForCwd: (cwd: string) => string,
  transcript: (session: TransitionNotice['session']) => Entry[] = () => [],
  canJump: (sessionId: string) => Promise<boolean> = async () => true,
) {
  if (!enabled) return;
  const { session } = notice;
  const card = CARD_FOR_NOTICE[notice.kind];
  const root = rootForCwd(session.cwd);
  const described = describeNotice(notice.kind, transcript(session), root);
  const shown: NotificationCard = {
    id: `session-${session.id}-${session.state}-${session.updatedAt}`,
    kind: card.kind,
    title: described.title || card.title,
    context: described.context || card.context,
    cwd: session.cwd,
    // Only an interactive session has a terminal to jump to.
    sessionId: session.id.startsWith('interactive:') ? session.sessionId ?? '' : '',
    repoName: path.basename(root) || session.project,
    branch: root ? readBranch(root) : '',
  };
  if (!shown.sessionId) return show(shown);
  // A terminal button that lands nowhere is worse than none.
  return canJump(shown.sessionId)
    .catch(() => false)
    .then((jumps) => show(jumps ? shown : { ...shown, sessionId: '' }))
    .catch((err) => console.error('Could not show the card:', err));
}

export { CARD_KINDS, deliverTransitionCard, sampleCard, sampleLabel };
export type { CardKind, NotificationCard };
