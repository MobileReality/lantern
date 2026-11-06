import { mountTrayPopover } from './lib/tray-popover-view';
import { byId } from './lib/util';

const view = mountTrayPopover(byId('pop'), window.trayPopover);

window.trayPopover.onOpen(({ model, maxHeight }) => view.open(model, maxHeight));
window.trayPopover.onModel(view.update);
