import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../dist/config.js';
import { Store } from '../dist/state.js';
import { Budget } from '../dist/budget.js';
import { CodingTools } from '../dist/tools.js';
import { parsePlan } from '../dist/plan.js';
import { fixturePlan } from './helpers.mjs';
import { Stop } from '../dist/errors.js';

test('supervisor records foreground completion and recovers result without replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codegen-process-'));
  const s = Store.create(loadConfig(undefined, { stateDir: join(root, 'state') }), root, parsePlan(fixturePlan()));
  const budget = new Budget(s); budget.start(); const t = new CodingTools(s, budget);
  try {
    const result = await t.shell('printf hello', '.');
    assert.equal(result.code, 0); assert.equal(result.stdoutTail, 'hello');
    assert.ok(existsSync(result.stdout));
    s.state.actions[result.actionId].status = 'pending'; s.save();
    await t.recover(); assert.equal(s.state.actions[result.actionId].status, 'done');
  } finally { await t.processes.cleanup(); budget.stop(); }
});

test('target tests do run when the agent is invoked from a Node test harness', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codegen-child-env-'));
  const s = Store.create(loadConfig(undefined, { stateDir: join(root, 'state') }), root, parsePlan(fixturePlan()));
  const b = new Budget(s); b.start(); const t = new CodingTools(s, b);
  try {
    const result = await t.shell(`${JSON.stringify(process.execPath)} -e 'if (process.env.NODE_TEST_CONTEXT) process.exit(9); console.log("clean test environment")'`, '.');
    assert.equal(result.code, 0); assert.match(result.stdoutTail, /clean test environment/);
  } finally { await t.processes.cleanup(); b.stop(); }
});

test('interrupted foreground command is reconciled from supervisor result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codegen-interrupt-'));
  const s = Store.create(loadConfig(undefined, { stateDir: join(root, 'state'), shutdownGraceMs: 500 }), root, parsePlan(fixturePlan()));
  const b = new Budget(s); b.start(); const t = new CodingTools(s, b);
  const timer = setTimeout(() => b.controller.abort(new Stop('interrupted', 'SIGINT', 'test interruption')), 350);
  try {
    await assert.rejects(t.shell('sleep 10', '.'), /test interruption/);
    const action = Object.values(s.state.actions).find(a => a.name === 'shell');
    assert.equal(action.status, 'pending');
    await t.processes.cleanup();
    await t.recover();
    assert.equal(action.status, 'done');
  } finally { clearTimeout(timer); await t.processes.cleanup(); b.stop(); }
});
