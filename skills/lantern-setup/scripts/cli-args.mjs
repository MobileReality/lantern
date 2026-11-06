import path from 'node:path';

export const ARGS_PROBLEM = Object.freeze({ MISSING_VALUE: 'missing-value', UNKNOWN_FLAG: 'unknown-flag' });

export class ArgsError extends Error {
    constructor(problem, flag) {
        super(`${problem} --${flag}`);
        this.problem = problem;
        this.flag = flag;
    }
}

function readFlag(argv, index, name, { valueFlags, repeatFlags, boolFlags }, flags) {
    if (valueFlags.includes(name)) {
        const value = argv[index + 1];
        if (boolFlags && (value === undefined || value.startsWith('--'))) throw new ArgsError(ARGS_PROBLEM.MISSING_VALUE, name);
        if (repeatFlags.includes(name)) {
            flags[name] ??= [];
            flags[name].push(value);
        } else flags[name] = value;
        return 1;
    }
    if (boolFlags && !boolFlags.includes(name)) throw new ArgsError(ARGS_PROBLEM.UNKNOWN_FLAG, name);
    flags[name] = true;
    return 0;
}

export function parseArgs(argv, { commands, valueFlags = [], repeatFlags = [], boolFlags = null, rootArg = true }) {
    const positional = [];
    const flags = {};
    const spec = { valueFlags, repeatFlags, boolFlags };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg.startsWith('--')) i += readFlag(argv, i, arg.slice(2), spec, flags);
        else positional.push(arg);
    }
    const root = rootArg && positional.length && !commands.includes(positional[0]) ? positional.shift() : '.';
    const [command, ...args] = positional;
    return { root: path.resolve(root), command, args, flags };
}

export function fail(message, code = 2) {
    process.stderr.write(`${message}\n`);
    process.exit(code);
}
