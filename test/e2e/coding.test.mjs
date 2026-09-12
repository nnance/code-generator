import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixturePlan } from '../helpers.mjs';
const exec = promisify(execFile);

export function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'codegen-live-')); const repo = join(base, 'repo'); mkdirSync(repo);
  writeFileSync(join(repo, 'package.json'), '{"type":"module"}');
  writeFileSync(join(repo, 'add.js'), 'export function add(a, b) { return a - b; }\n');
  writeFileSync(join(repo, 'add.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './add.js';\ntest('adds positive and negative numbers', () => { assert.equal(add(2, 3), 5); assert.equal(add(-2, 3), 1); });\n");
  const plan = join(base, 'plan.md'); writeFileSync(plan, fixturePlan());
  const config = join(base, 'config.json'); writeFileSync(config, JSON.stringify({ version: 1, stateDir: join(base, 'state'), baseURL: process.env.RAPID_MLX_URL ?? 'http://127.0.0.1:8001/v1', model: process.env.RAPID_MLX_MODEL ?? 'qwen3.6-35b-8bit', maxTimeMs: 180000, output: 'json' }));
  return { base, repo, plan, config };
}
test('live agent fixes real code, verifies acceptance, and retains evidence', { timeout: 240000 }, async () => {
  const f = fixture(); const originalTest = readFileSync(join(f.repo, 'add.test.js'), 'utf8');
  let output;
  try { output = await exec(process.execPath, [resolve('dist/cli.js'), 'run', f.plan, '--target', f.repo, '--config', f.config], { timeout: 220000, maxBuffer: 20 * 1024 * 1024 }); }
  catch (e) { writeFileSync(join(f.base, 'failure.json'), JSON.stringify({ stdout: e.stdout, stderr: e.stderr })); throw new Error(`Live agent failed; artifacts: ${f.base}\n${e.stderr}\n${e.stdout?.slice(-4000)}`); }
  const events = output.stdout.trim().split('\n').map(line => JSON.parse(line));
  const final = events.findLast(e => e.type === 'terminal').payload;
  assert.equal(final.status, 'succeeded');
  assert.equal(readFileSync(join(f.repo, 'add.test.js'), 'utf8'), originalTest);
  await exec(process.execPath, ['--test'], { cwd: f.repo });
  assert.equal(final.steps.S1.status, 'completed');
  assert.ok(final.budget.tokens > 0);
  assert.ok(events.some(e => e.type === 'verification_verdict' && e.payload.passed));
  mkdirSync('.test-artifacts', { recursive: true });
  writeFileSync('.test-artifacts/coding.json', JSON.stringify({ artifactDirectory: f.base, final }, null, 2));
});
