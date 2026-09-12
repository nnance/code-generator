import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema } from '../../dist/config.js';
import { Store } from '../../dist/state.js';
import { Budget } from '../../dist/budget.js';
import { parsePlan } from '../../dist/plan.js';
import { transport } from '../../dist/transport.js';
import { assess } from '../../dist/assess.js';

for (const limited of [false, true]) {
  test(`live assessment ${limited ? 'reports output exhaustion accurately' : 'accepts the original detailed self-build plan'}`, { timeout: 300000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'codegen-assessment-'));
    const config = configSchema.parse({
      stateDir: join(root, 'state'), output: 'json',
      baseURL: process.env.RAPID_MLX_URL ?? 'http://127.0.0.1:8001/v1',
      model: process.env.RAPID_MLX_MODEL ?? 'qwen3.8-27b-4bit',
      ...(limited ? { maxOutputTokens: 1 } : {}),
    });
    const plan = parsePlan(readFileSync(new URL('../fixtures/version-plan.md', import.meta.url), 'utf8'));
    const store = Store.create(config, root, plan);
    const budget = new Budget(store);
    budget.start();
    try {
      if (limited) await assert.rejects(assess(store, budget, transport(store, budget)), error => {
        assert.equal(error.reason, 'assessment_output_limit');
        assert.match(error.message, /Increase maxOutputTokens/);
        return true;
      });
      else await assess(store, budget, transport(store, budget));
    } finally { budget.stop(); }
  });
}
