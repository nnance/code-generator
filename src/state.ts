import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, existsSync, readdirSync, truncateSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import type { Config } from './config.js';
import type { Plan } from './plan.js';
import { Stop } from './errors.js';

export interface Evidence { explanation: string; actions: string[]; revision: number; }
export interface Action { id: string; name: string; input: unknown; status: 'pending' | 'done' | 'failed'; output?: unknown; error?: string; }
export interface ProcessRecord { id: string; pid?: number; identity?: string; command: string; cwd: string; resultFile: string; stdout: string; stderr: string; background: boolean; }
export interface RunState {
  version: 1; id: string; created: string; status: string; target: string; sourceTarget: string;
  config: Config; plan: Plan; originalHash: string; revision: number;
  steps: Record<string, { status: 'pending' | 'in_progress' | 'completed' | 'blocked'; evidence?: Evidence }>;
  messages: ModelMessage[]; amendments: { text: string; time: string }[];
  actions: Record<string, Action>; processes: Record<string, ProcessRecord>;
  budget: { activeMs: number; tokens: number; reservations: Record<string, number>; uncertainTokens: number; heartbeatReservedMs: number };
  initialGit?: unknown; instructions: Record<string, string>; skills: Record<string, string>;
  reason?: { code: string; message: string }; initialFiles?: Record<string, string>;
  owner?: { pid: number; identity?: string };
  verification?: unknown;
  instructionContents?: Record<string, string>;
  skillContents?: Record<string, string>;
}
export function atomicJSON(path: string, value: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  const dir = openSync(resolve(path, '..'), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export class Store {
  seq = 0;
  constructor(public dir: string, public state: RunState, public emit?: (event: Record<string, unknown>) => void) {}
  static create(config: Config, target: string, plan: Plan, emit?: Store['emit']) {
    const id = randomUUID(); const dir = join(config.stateDir, 'runs', id);
    mkdirSync(join(dir, 'artifacts'), { recursive: true, mode: 0o700 });
    const state: RunState = { version: 1, id, created: new Date().toISOString(), status: 'running', target, sourceTarget: target, config, plan, originalHash: plan.hash, revision: 1,
      steps: Object.fromEntries(plan.steps.map(s => [s.id, { status: 'pending' }])), messages: [], amendments: [], actions: {}, processes: {},
      budget: { activeMs: 0, tokens: 0, reservations: {}, uncertainTokens: 0, heartbeatReservedMs: 0 }, instructions: {}, skills: {} };
    const store = new Store(realpathSync(dir), state, emit);
    writeFileSync(join(dir, 'plan.original.md'), plan.source, { mode: 0o600 });
    atomicJSON(join(dir, 'run.json'), { version: 1, id, created: state.created, target, config });
    store.save(); return store;
  }
  static load(stateDir: string, id: string, emit?: Store['emit']) {
    if (!/^[a-f\d-]{36}$/.test(id)) throw new Stop('invalid_input', 'invalid_run_id', 'Invalid run ID');
    const dir = join(stateDir, 'runs', id);
    if (!existsSync(join(dir, 'events.jsonl'))) throw new Stop('invalid_input', 'unknown_run', `Run ${id} does not exist`);
    const raw = readFileSync(join(dir, 'events.jsonl'), 'utf8');
    const end = raw.lastIndexOf('\n') + 1;
    let state: RunState | undefined; let seq = 0;
    try {
      for (const line of raw.slice(0, end).split('\n').filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.version !== 1 || event.sequence !== ++seq || event.runId !== id) throw new Error('Journal sequence/version mismatch');
        if (event.type === 'checkpoint') state = event.payload;
        else if (event.type === 'budget_checkpoint' && state) state.budget = event.payload;
      }
      if (!state || state.version !== 1 || state.id !== id) throw new Error('Missing valid checkpoint');
    } catch (e) { throw new Stop('internal_error', 'state_corrupt', `Cannot recover ${id}: ${e}`); }
    const store = new Store(realpathSync(dir), state, emit); store.seq = seq; return store;
  }
  repairTail() {
    const path = join(this.dir, 'events.jsonl'); const data = readFileSync(path);
    const last = data.lastIndexOf(10) + 1;
    if (last < data.length) {
      writeFileSync(join(this.dir, 'artifacts', `journal-tail-${randomUUID()}.bin`), data.subarray(last), { mode: 0o600 });
      truncateSync(path, last);
    }
  }
  event(type: string, payload: unknown, visible = true) {
    const event = { version: 1, sequence: ++this.seq, timestamp: new Date().toISOString(), runId: this.state.id, type, payload };
    const fd = openSync(join(this.dir, 'events.jsonl'), 'a', 0o600);
    try { writeFileSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    if (visible) this.emit?.(event); return event.sequence;
  }
  save() { this.event('checkpoint', this.state, false); atomicJSON(join(this.dir, 'checkpoint.json'), this.state); }
  saveBudget() { this.event('budget_checkpoint', this.state.budget, false); }
  artifact(name: string, value: unknown) {
    const path = join(this.dir, 'artifacts', `${name}-${randomUUID()}.json`); atomicJSON(path, value); return path;
  }
  intent(name: string, input: unknown) {
    const action: Action = { id: randomUUID(), name, input, status: 'pending' };
    this.state.actions[action.id] = action; this.save(); this.event('tool_intent', action); return action;
  }
  complete(action: Action, output: unknown) { action.output = output; action.status = 'done'; this.save(); this.event('tool_result', action); }
  fail(action: Action, error: unknown) { action.error = String(error); action.status = 'failed'; this.save(); this.event('tool_result', action); }
  static list(stateDir: string) {
    const path = join(stateDir, 'runs'); return existsSync(path) ? readdirSync(path).filter(x => /^[a-f\d-]{36}$/.test(x)) : [];
  }
}
