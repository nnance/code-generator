import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { Store } from './state.js';
import { Stop } from './errors.js';

export class Budget {
  controller = new AbortController();
  last = performance.now();
  timer?: NodeJS.Timeout;
  deadline?: NodeJS.Timeout;
  constructor(public store: Store) {}
  start() {
    const b = this.store.state.budget;
    b.activeMs += b.heartbeatReservedMs; b.heartbeatReservedMs = 0;
    for (const [id, n] of Object.entries(b.reservations)) { b.tokens += n; b.uncertainTokens += n; delete b.reservations[id]; }
    this.check(); this.last = performance.now(); this.tick();
    this.timer = setInterval(() => { try { this.tick(); this.check(); } catch (e) { this.controller.abort(e); } }, 1000);
    const max = this.store.state.config.maxTimeMs;
    if (max !== null) this.deadline = setTimeout(() => this.controller.abort(new Stop('budget_exhausted', 'time_limit', 'Active-time allowance exhausted. Increase the total with --max-time to resume.')), Math.min(max - b.activeMs, 2147483647));
  }
  tick() { const now = performance.now(); const b = this.store.state.budget; b.activeMs += now - this.last; this.last = now; b.heartbeatReservedMs = 1000; this.store.save(); }
  check() {
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
    const { config: c, budget: b } = this.store.state;
    if (c.maxTimeMs !== null && b.activeMs >= c.maxTimeMs) throw new Stop('budget_exhausted', 'time_limit', 'Active-time allowance exhausted. Increase --max-time to resume.');
    if (c.maxTokens !== null && b.tokens + Object.values(b.reservations).reduce((a, x) => a + x, 0) >= c.maxTokens) throw new Stop('budget_exhausted', 'token_limit', 'Token allowance exhausted. Increase --max-tokens to resume.');
  }
  reserve(inputUpperBound: number, requestedOutput: number) {
    this.check(); const { budget: b, config: c } = this.store.state;
    const remaining = c.maxTokens === null ? Infinity : c.maxTokens - b.tokens - Object.values(b.reservations).reduce((a, n) => a + n, 0);
    const output = Math.min(requestedOutput, remaining - inputUpperBound);
    if (output < 1) throw new Stop('budget_exhausted', 'token_reservation', 'Remaining tokens cannot cover the next request. Increase the total token allowance.');
    const id = randomUUID(); b.reservations[id] = inputUpperBound + output; this.store.save(); return { id, output };
  }
  settle(id: string, input?: number, output?: number) {
    const b = this.store.state.budget; const reserved = b.reservations[id];
    if (reserved === undefined) return;
    const known = input !== undefined && output !== undefined;
    const actual = known ? input + output : reserved;
    b.tokens += actual; if (!known) b.uncertainTokens += actual;
    delete b.reservations[id]; this.store.save();
    if (known && actual > reserved && this.store.state.config.maxTokens !== null) throw new Stop('blocked', 'accounting_mismatch', 'Provider exceeded its reserved token bound; token-limited execution cannot safely continue.');
  }
  stop() {
    clearInterval(this.timer); clearTimeout(this.deadline);
    for (const id of Object.keys(this.store.state.budget.reservations)) this.settle(id);
    const b = this.store.state.budget; b.activeMs += performance.now() - this.last; b.heartbeatReservedMs = 0; this.store.save();
  }
}
