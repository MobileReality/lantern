type Outcome<T, E> = { value: T } | { error: E };

const done = <T>(value: T): { value: T } => ({ value });

const refuse = <E>(error: E): { error: E } => ({ error });

const andThen = <T, U, E>(outcome: Outcome<T, E>, next: (value: T) => Outcome<U, E>): Outcome<U, E> => ('error' in outcome ? outcome : next(outcome.value));

export { andThen, done, refuse };
export type { Outcome };
