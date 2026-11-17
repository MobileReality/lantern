import { installPopoverShim } from './support/popover-shim';

if (typeof window !== 'undefined') installPopoverShim(window);
