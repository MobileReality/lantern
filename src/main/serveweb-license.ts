export const SERVER_LICENSE_URL = 'https://aka.ms/vscode-server-license';

export interface ServerLicenseConsent {
  accepted: () => boolean;
  ask: () => Promise<boolean>;
}

interface LicenseDeps {
  stored: () => boolean;
  remember: () => void;
  ask: () => Promise<boolean>;
}

export function createServerLicenseConsent({ stored, remember, ask }: LicenseDeps): ServerLicenseConsent {
  let pending: Promise<boolean> | null = null;
  return {
    accepted: stored,
    ask: () => {
      if (stored()) return Promise.resolve(true);
      if (pending) return pending;
      const question = ask()
        .then((granted) => {
          if (granted) remember();
          return granted;
        })
        .catch(() => false)
        .finally(() => {
          pending = null;
        });
      pending = question;
      return question;
    },
  };
}
