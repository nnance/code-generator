export type Category = 'invalid_input' | 'blocked' | 'budget_exhausted' | 'internal_error' | 'locked' | 'interrupted';
export const exitCodes = { succeeded: 0, invalid_input: 2, blocked: 3, budget_exhausted: 4, internal_error: 5, locked: 6, interrupted: 130 };
export class Stop extends Error {
  constructor(public category: Category, public reason: string, message: string) { super(message); }
}
export function failure(error: unknown): Stop {
  return error instanceof Stop ? error : new Stop('internal_error', 'unexpected_error', error instanceof Error ? error.message : String(error));
}
