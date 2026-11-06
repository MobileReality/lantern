export type RtkEdition = 'full' | 'oss' | 'unknown';
export type RtkReason = 'not-installed' | 'not-rtk' | 'probe-failed';

export interface RtkStatus {
  found: boolean;
  path: string | null;
  version: string | null;
  edition: RtkEdition | null;
  hookFound: boolean;
  hookFiles: string[];
  reason: RtkReason | null;
}
