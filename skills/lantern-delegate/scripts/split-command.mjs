// split-command.mjs — quote-aware split of a shell command into segments of words.
// `;`, `&&`, `||`, `|`, `&` and newlines outside quotes end a segment; quotes are removed from the
// words; unquoted redirections (`2>&1`, `> file`) are dropped, and `< file` keeps the file as a word
// because it is read. A quoted `>` is an ordinary word. It only reads, never runs anything.

export function splitCommand(command) {
    return splitPipeline(command).map((segment) => segment.words);
}

export function splitPipeline(command) {
    const segments = [];
    let words = [];
    let quoted = [];
    let word = '';
    let inWord = false;
    let wordQuoted = false;
    let quote = null;
    let pipePending = false;
    const endWord = () => {
        if (inWord) {
            words.push(word);
            quoted.push(wordQuoted);
        }
        word = '';
        inWord = false;
        wordQuoted = false;
    };
    const endSegment = () => {
        endWord();
        if (words.length) {
            segments.push({ words: stripRedirections(words, quoted), afterPipe: pipePending });
            pipePending = false;
        }
        words = [];
        quoted = [];
    };
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        const next = command[i + 1];
        if (quote === "'") {
            if (c === "'") quote = null;
            else word += c;
        } else if (quote === '"') {
            if (c === '"') quote = null;
            else if (c === '\\' && next !== undefined) {
                word += next;
                i++;
            } else word += c;
        } else if (c === "'" || c === '"') {
            quote = c;
            inWord = true;
            wordQuoted = true;
        } else if (c === '\\' && next !== undefined) {
            if (next !== '\n') {
                word += next;
                inWord = true;
            }
            i++;
        } else if (c === '#' && !inWord) {
            while (i + 1 < command.length && command[i + 1] !== '\n') i++;
        } else if (c === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || next === '>')) {
            word += c;
            inWord = true;
        } else if (c === '&' || c === '|' || c === ';' || c === '\n') {
            const isSinglePipe = c === '|' && next !== '|';
            if ((c === '&' || c === '|') && next === c) i++;
            endSegment();
            pipePending = isSinglePipe;
        } else if (c === ' ' || c === '\t') endWord();
        else {
            word += c;
            inWord = true;
        }
    }
    endSegment();
    return segments;
}

function stripRedirections(words, quoted) {
    const out = [];
    for (let i = 0; i < words.length; i++) {
        const m = quoted[i] ? null : /^\d*(>>?|<)(&?)(.*)$/.exec(words[i]);
        if (!m) out.push(words[i]);
        else if (m[1] === '<' && m[2] === '') {
            if (m[3] !== '') out.push(m[3]);
        } else if (m[3] === '' && m[2] === '') i++;
    }
    return out;
}
