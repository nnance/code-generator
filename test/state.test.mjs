import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/state.js';
import { Budget } from '../dist/budget.js';
import { lock } from '../dist/locks.js';
import { loadConfig } from '../dist/config.js';
import { parsePlan } from '../dist/plan.js';
import { fixturePlan } from './helpers.mjs';
function setup() { const dir = mkdtempSync(join(tmpdir(), 'codegen-state-')); return Store.create(loadConfig(undefined, { stateDir: dir, maxTokens: 100 }), dir, parsePlan(fixturePlan())); }
test('journal recovers intent after truncated tail without replaying it', () => {
  const s = setup(); const action = s.intent('shell', { command: 'a-side-effect' });
  appendFileSync(join(s.dir, 'events.jsonl'), '{"partial":');
  const recovered = Store.load(s.state.config.stateDir, s.state.id);
  assert.equal(recovered.state.actions[action.id].status, 'pending');
  recovered.repairTail(); recovered.save();
  assert.doesNotThrow(() => Store.load(s.state.config.stateDir, s.state.id));
});
test('unknown usage stays charged across resume and explicit increases replace totals', () => {
  const s = setup(); const b = new Budget(s); b.reserve(60, 20);
  const recovered = Store.load(s.state.config.stateDir, s.state.id); const next = new Budget(recovered);
  next.start();
  assert.equal(recovered.state.budget.tokens, 80);
  assert.equal(recovered.state.budget.uncertainTokens, 80);
  assert.throws(() => next.reserve(30, 10), /Remaining tokens/);
  recovered.state.config.maxTokens = 150;
  const r = next.reserve(30, 10); next.settle(r.id, 25, 5);
  assert.equal(recovered.state.budget.tokens, 110); next.stop();
});
test('overlapping directories lock but independent paths do not', () => {
  const s = setup(); const target = join(s.state.target, 'repo'); mkdirSync(target);
  const sub = join(target, 'sub'); mkdirSync(sub);
  const other = join(s.state.target, 'other'); mkdirSync(other);
  const release = lock(s.state.config.stateDir, target, s.state.id);
  assert.throws(() => lock(s.state.config.stateDir, sub, 'another'), /owned by/);
  const releaseOther = lock(s.state.config.stateDir, other, 'another'); releaseOther(); release();
});
test('corrupt journal fails instead of silently reverting to snapshot', () => {
  const s = setup(); appendFileSync(join(s.dir, 'events.jsonl'), 'broken\n');
  assert.throws(() => Store.load(s.state.config.stateDir, s.state.id), /Cannot recover/);
  assert.ok(readFileSync(join(s.dir, 'events.jsonl'), 'utf8').endsWith('broken\n'));
});
