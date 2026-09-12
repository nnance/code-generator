import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePlan } from '../dist/plan.js';
import { loadConfig, duration } from '../dist/config.js';
import { fixturePlan } from './helpers.mjs';

test('valid plan extracts executable checks and rejects dangling references', () => {
  const plan = parsePlan(fixturePlan());
  assert.equal(plan.criteria[0].command, 'node --test');
  assert.equal(plan.steps[0].criteria[0], 'AC1');
  assert.throws(() => parsePlan(fixturePlan().replace('Acceptance criteria: AC1', 'Acceptance criteria: AC9')), /Unknown criterion/);
});

test('template placeholders cannot be submitted', () => assert.throws(() => parsePlan(readFileSync('PLAN_TEMPLATE.md', 'utf8')), /placeholder/));
test('budgets require positive bounds and invalid config keys fail', () => {
  assert.throws(() => loadConfig(undefined, { maxTimeMs: null, maxTokens: null }), /finite/);
  assert.throws(() => loadConfig(undefined, { maxTokens: -1 }), /Invalid configuration/);
  assert.throws(() => loadConfig(undefined, { typo: 1 }), /Invalid configuration/);
  assert.equal(duration('1.5h'), 5400000);
  assert.throws(() => duration('Infinityh'));
});
