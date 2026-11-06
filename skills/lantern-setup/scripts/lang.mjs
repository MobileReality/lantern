#!/usr/bin/env node
import { readLang } from './lib.mjs';

process.stdout.write(`${readLang(process.argv[2] ?? '.')}\n`);
