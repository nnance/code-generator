import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fixturePlan } from '../helpers.mjs';
const exec = promisify(execFile);

test('live director monitors a blocker and resumes the same implementation run', { timeout: 600000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'codegen-delegation-'));
  const repo = join(base, 'repo'); mkdirSync(repo);
  writeFileSync(join(repo, 'add.js'), 'export function add(a, b) { return a - b; }\n');
  writeFileSync(join(repo, 'package.json'), '{"type":"module"}');
  const checks = "import assert from 'node:assert/strict'; import { add } from './add.js'; assert.equal(add(2, 3), 5); assert.equal(add(-2, 3), 1); console.log('Addition verified');\n";
  writeFileSync(join(repo, 'check.mjs'), checks);
  const plan = join(base, 'plan.md');
  writeFileSync(plan, fixturePlan('node check.mjs').replace('Action: Read add.js and tests.', 'Action: First read director-contract.txt. It is a required externally supplied prerequisite. If missing, report a blocker and stop before editing code; do not create it yourself. Once available, follow its numeric addition contract. Read add.js and tests.'));
  const config = join(base, 'config.json');
  writeFileSync(config, JSON.stringify({ stateDir: join(base, 'state'), output: 'json', maxTimeMs: 540000, baseURL: process.env.RAPID_MLX_URL ?? 'http://127.0.0.1:8001/v1', model: process.env.RAPID_MLX_MODEL ?? 'qwen3.8-27b-4bit' }));
  const cli = resolve('dist/cli.js');
  const query = async (command, id) => JSON.parse((await exec(process.execPath, [cli, command, id, '--config', config, '--json'])).stdout);
  const launch = (args, onStart) => new Promise((yes, no) => {
    const child = spawn(process.execPath, [cli, ...args, '--config', config, '--output', 'json']);
    let output = '', error = '', pending = ''; const events = []; let monitor = Promise.resolve();
    child.stdout.on('data', chunk => {
      output += chunk; pending += chunk; const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        const event = JSON.parse(line); events.push(event);
        if (event.type === 'run_start' && onStart) { monitor = onStart(event.payload.id); monitor.catch(() => {}); }
      }
    });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', no);
    child.on('close', async code => {
      writeFileSync(join(base, `${args[0]}.jsonl`), output);
      try { await monitor; yes({ code, events, error }); } catch (e) { no(e); }
    });
  });
  const first = await launch(['run', plan, '--target', repo], async id => {
    const active = await query('status', id);
    assert.equal(active.id, id); assert.equal(active.status, 'running');
  });
  assert.equal(first.code, 3, `${base}: ${first.error}`);
  const stop = first.events.findLast(e => e.type === 'terminal').payload;
  assert.equal(stop.status, 'blocked');
  assert.match(stop.reason.message, /director-contract|prerequisite/i);
  assert.match(readFileSync(join(repo, 'add.js'), 'utf8'), /a - b/);
  const before = await query('inspect', stop.id);
  assert.equal((await query('status', stop.id)).status, 'blocked');
  writeFileSync(join(repo, 'director-contract.txt'), 'add(a, b) returns the numeric sum of its two numeric arguments.\n');
  const second = await launch(['resume', stop.id, '--instructions', 'The required director-contract.txt has now been supplied externally. Read it and continue the original plan. Preserve all acceptance criteria and existing checks.']);
  assert.equal(second.code, 0, `${base}: ${second.error}; inspect resume.jsonl`);
  const after = await query('inspect', stop.id);
  assert.equal(after.id, before.id); assert.equal(after.status, 'succeeded');
  assert.equal(after.originalHash, before.originalHash);
  assert.deepEqual(after.plan.criteria, before.plan.criteria);
  assert.ok(after.budget.tokens > before.budget.tokens);
  assert.ok(after.budget.activeMs > before.budget.activeMs);
  assert.equal(after.amendments.length, 1);
  assert.equal(readFileSync(join(repo, 'check.mjs'), 'utf8'), checks);
  assert.equal((await exec(process.execPath, ['check.mjs'], { cwd: repo })).stdout.trim(), 'Addition verified');
  mkdirSync('.test-artifacts', { recursive: true });
  writeFileSync('.test-artifacts/delegation.json', JSON.stringify({ base, runId: stop.id, before: before.status, after: after.status, budget: after.budget }, null, 2));
});
