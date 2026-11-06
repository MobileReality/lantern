const REASON_MAX_CHARS = 160;

const REASON_RULE = [
  'One sentence saying why the change was made in that file, not what changed: the reviewer already sees the diff.',
  'Good: "Rejects a negative pid before it reaches kill()". Never: "Changed the guard".',
  `At most ${REASON_MAX_CHARS} characters, plain text: no markup, no newlines.`,
];

export { REASON_MAX_CHARS, REASON_RULE };
