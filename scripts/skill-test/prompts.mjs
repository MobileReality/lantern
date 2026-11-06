import { BASE_BRANCH } from './fixtures.mjs';

export const SETUP_PROMPT = [
  'Use the lantern-setup skill to build the .lantern/ map of this project, unattended: nobody can answer questions.',
  'Map every file it lists, validate with validate.mjs --settled until it prints OK, and write nothing outside .lantern/.',
  'Do not commit.',
].join(' ');

export const SYNC_PROMPT = [
  `Use the lantern-sync skill on this branch (base ${BASE_BRANCH}), unattended: nobody can answer questions.`,
  'The code change is already committed. Run finish with your exact model id, re-map exactly the files it lists,',
  'validate with validate.mjs --settled, run finish again until it prints WORK LIST EMPTY,',
  'then commit .lantern/ only with the message "chore: update the Lantern map".',
  'Do not push, open no pull request, and change no file outside .lantern/.',
].join(' ');

export const RETAG_PROMPT = [
  'Use the lantern-setup skill in its Retag mode on this project, unattended: nobody can answer questions.',
  'Its .lantern/ map already exists; do not re-map any file, only clean up its feature tags, outside systems and the untagged records the plan lists, the way the skill says.',
  'Finish when validate.mjs --settled --strict exits 0, and write nothing outside .lantern/.',
  'Do not commit.',
].join(' ');

export const AREAS_PROMPT = [
  'Use the lantern-setup skill, its Areas loop (step 4a), on this project, unattended: nobody can answer questions.',
  'Its .lantern/ map already exists and is settled; do not re-map any file.',
  'Write .lantern/areas and the areas text, run areas.mjs check until it passes, and keep the flat view if it cannot.',
  'Write nothing outside .lantern/. Do not commit.',
].join(' ');

export const AREAS_ADD_PROMPT = [
  'Follow the lantern-delegate protocol.md map-update step on this project, unattended: nobody can answer questions.',
  'The change adds a feature, gift-wrapping, with its source file; map it and declare the feature.',
  'Place it in .lantern/areas the way that step says, then run areas.mjs check --allow-unassigned until it passes.',
  'If it fits no area, run only the Areas loop of lantern-setup as that step says and regroup the existing features plus the new one.',
  'Do not commit.',
].join(' ');

export const AREAS_ADD_FAILING_PROMPT = `${AREAS_ADD_PROMPT} The areas loop fails within its 3 rounds here: leave the existing tree untouched and the feature in "To assign".`;

export const AREAS_MERGED_PROMPT = [
  'Follow the lantern-delegate protocol.md map-update step and its ship-time rule on this project, unattended: nobody can answer questions.',
  'The change added the feature gift-wrapping, and the target branch was merged in: .lantern/areas is now the target branch tree, which does not hold gift-wrapping.',
  'Re-place only your own feature with the rules of that step, run areas.mjs check --allow-unassigned, rebuild only if it no longer fits.',
  'Do not commit.',
].join(' ');

const AREAS_SCRATCH = 'Use .ai/tmp/areas as the scratch directory for every file you create outside .lantern/.';

export const LANTERN_AREAS_SETUP_PROMPT = [
  'Use the lantern-setup skill on this project, unattended: nobody can answer questions.',
  'Its .lantern/ map is already built and settled, so do not re-map any file; do the rest of the setup the skill describes.',
  'Write nothing outside .lantern/ and .ai/tmp/areas. Do not commit.',
  AREAS_SCRATCH,
].join(' ');

export const LANTERN_AREAS_RETAG_PROMPT = [
  'Use the lantern-setup skill in its Retag mode on this project, unattended: nobody can answer questions.',
  'Its .lantern/ map already exists; do not re-map any file, only do what the skill says for Retag mode.',
  'Finish when validate.mjs --settled --strict exits 0, and write nothing outside .lantern/ and .ai/tmp/areas.',
  'Do not commit.',
  AREAS_SCRATCH,
].join(' ');

export const LANTERN_AREAS_DELEGATE_PROMPT = [
  'Follow the lantern-delegate protocol.md map-update step on this project, unattended: nobody can answer questions.',
  'The change adds one feature, staff-rota: its source files, under api/staff-rota and storefront/staff-rota, are in the working tree and not mapped yet.',
  'Leave .lantern/ true for them. Change no source file. Do not commit.',
  AREAS_SCRATCH,
].join(' ');
