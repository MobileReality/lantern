import type { ProjectFile } from '../../main/filecontent';
import type { PrFile } from '../../main/lantern-prfile';
import type { ReadFile } from './codemodal';
import { isLocalId, prRef } from '../../shared/local-review';

type ReadPrFile = (pr: string, path: string) => Promise<PrFile>;

function prFileReader(read: ReadPrFile, pr: string): ReadFile {
  return async (path): Promise<ProjectFile> => {
    const res = await read(pr, path);
    if (!res.ok) return { exists: false, text: '', truncated: 0, reason: res.reason || 'unknown reason' };
    if (res.binary) return { exists: false, text: '', truncated: 0, reason: 'binary file, no text to show' };
    const ref = prRef(pr);
    const note = isLocalId(pr) ? (res.version === 'before' ? `version before ${ref}` : `${ref}: compared version`) : res.version === 'before' ? `version before PR ${ref}` : `PR ${ref} branch version`;
    return { exists: true, text: res.text, truncated: 0, clipped: res.truncated, note, ...(res.source ? { source: res.source } : {}) };
  };
}

export { prFileReader };
export type { ReadPrFile };
