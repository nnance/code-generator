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
