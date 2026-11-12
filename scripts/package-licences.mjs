import { addElectronLicences, packagedLayout } from './licenses.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const platform = valueAfter('--platform');
const arch = valueAfter('--arch');
if (!platform || !arch) throw new Error('Usage: node scripts/package-licences.mjs --platform <darwin|win32|linux> --arch <arch>');

const files = addElectronLicences(packagedLayout(valueAfter('--dist') ?? 'dist', platform, arch));
console.log(`package-licences: ${files.join(', ')} added to the packaged app`);
