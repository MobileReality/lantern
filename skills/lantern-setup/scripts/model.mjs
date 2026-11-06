#!/usr/bin/env node
import { codexFloorLabel, modelAdvisory, modelAllowed, modelFloorLabel } from './lib.mjs';

const [command, id] = process.argv.slice(2);
if (command === 'floor') {
    console.log(id === 'codex' ? codexFloorLabel() : modelFloorLabel());
} else if (command === 'check' && id) {
    const ok = modelAllowed(id);
    const advisory = ok ? modelAdvisory(id) : null;
    console.log(ok ? `OK ${id}${advisory ? ` (${advisory})` : ''}` : `NOT ALLOWED ${id}`);
    process.exit(ok ? 0 : 1);
} else {
    console.error('usage: model.mjs floor [codex] | check <model-id>');
    process.exit(2);
}
