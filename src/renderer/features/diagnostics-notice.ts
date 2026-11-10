import { CRASH_NOTICE_TITLE, type CrashNotice } from '../../shared/diagnostics';
import { GITHUB_CLIPBOARD, GITHUB_OPENED, REPORT_FAILED } from '../lib/diagnosticsview';
import { byId } from '../lib/util';

interface NoticeActions {
  notice(): Promise<CrashNotice | null>;
  github(request: { crash: true }): Promise<{ ok: boolean; copied: boolean }>;
  dismiss(): Promise<unknown>;
}

export async function showCrashNotice(actions: NoticeActions) {
  const host = byId('crash-notice');
  const notice = await actions.notice().catch(() => null);
  if (!notice) return host.classList.add('hidden');
  const message = byId('crash-notice-text');
  const report = byId('crash-notice-report');
  const dismiss = byId('crash-notice-dismiss');
  host.querySelector('.crash-notice-title')!.textContent = CRASH_NOTICE_TITLE[notice.reason];
  message.textContent = 'Read the report first. Nothing is sent unless you submit it on GitHub.';
  host.classList.remove('hidden');
  const close = () => {
    host.classList.add('hidden');
    void actions.dismiss();
  };
  report.addEventListener('click', async () => {
    try {
      const outcome = await actions.github({ crash: true });
      message.textContent = !outcome.ok ? REPORT_FAILED : outcome.copied ? GITHUB_CLIPBOARD : GITHUB_OPENED;
      if (!outcome.ok) return;
      report.classList.add('hidden');
      void actions.dismiss();
    } catch {
      message.textContent = REPORT_FAILED;
    }
  });
  dismiss.addEventListener('click', close);
}
