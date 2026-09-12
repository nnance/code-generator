import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fixturePlan } from '../helpers.mjs';
import { readdirSync } from 'node:fs';
import { Store } from '../../dist/state.js';
import { Budget } from '../../dist/budget.js';
import { compact } from '../../dist/agent.js';
import { loadConfig } from '../../dist/config.js';
import { parsePlan } from '../../dist/plan.js';
import { probe } from '../../dist/model.js';
import { transport } from '../../dist/transport.js';
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
  const config = JSON.parse(readFileSync(f.config, 'utf8')); config.maxTokens = 1000000; writeFileSync(f.config, JSON.stringify(config));
  writeFileSync(join(f.repo, 'README.md'), 'Initial notes\n');
  await exec('git', ['init', '-b', 'main', f.repo]);
  await exec('git', ['-C', f.repo, 'add', '.']);
  await exec('git', ['-C', f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  writeFileSync(join(f.repo, 'README.md'), 'Unrelated unfinished user notes\n');
  let output;
  try { output = await exec(process.execPath, [resolve('dist/cli.js'), 'run', f.plan, '--target', f.repo, '--config', f.config], { timeout: 220000, maxBuffer: 20 * 1024 * 1024 }); }
  catch (e) { writeFileSync(join(f.base, 'failure.json'), JSON.stringify({ stdout: e.stdout, stderr: e.stderr })); throw new Error(`Live agent failed; artifacts: ${f.base}\n${e.stderr}\n${e.stdout?.slice(-4000)}`); }
  const events = output.stdout.trim().split('\n').map(line => JSON.parse(line));
  const final = events.findLast(e => e.type === 'terminal').payload;
  assert.equal(final.status, 'succeeded');
  assert.equal(readFileSync(join(f.repo, 'add.test.js'), 'utf8'), originalTest);
  assert.equal(readFileSync(join(f.repo, 'README.md'), 'utf8'), 'Unrelated unfinished user notes\n');
  const cleanEnv = { ...process.env }; delete cleanEnv.NODE_TEST_CONTEXT; delete cleanEnv.NODE_TEST_WORKER_ID;
  const independent = await exec(process.execPath, ['--test'], { cwd: f.repo, env: cleanEnv });
  assert.match(independent.stdout, /(?:pass 1|1 passing)/);
  assert.equal(final.steps.S1.status, 'completed');
  assert.ok(final.budget.tokens > 0);
  assert.ok(events.some(e => e.type === 'verification_verdict' && e.payload.passed));
  mkdirSync('.test-artifacts', { recursive: true });
  writeFileSync('.test-artifacts/coding.json', JSON.stringify({ artifactDirectory: f.base, final }, null, 2));
});

test('live run survives a hard crash after a write and resumes with cumulative budgets', { timeout: 300000 }, async t => {
  const f = fixture();
  const child = spawn(process.execPath, [resolve('dist/cli.js'), 'run', f.plan, '--target', f.repo, '--config', f.config], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (!child.killed) child.kill('SIGTERM'); });
  let buffer = '', crashed = false, stderr = '';
  child.stderr.on('data', c => { stderr += c; });
  child.stdout.on('data', chunk => {
    buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      const e = JSON.parse(line);
      if (!crashed && e.type === 'tool_result' && e.payload.status === 'done' && /a\s*\+\s*b/.test(readFileSync(join(f.repo, 'add.js'), 'utf8'))) { crashed = true; child.kill('SIGKILL'); }
    }
  });
  await new Promise((yes, no) => { child.on('error', no); child.on('close', yes); });
  assert.ok(crashed, `Expected a real write before crash: ${stderr}; artifacts ${f.base}`);
  const id = readdirSync(join(f.base, 'state/runs'))[0]; const before = Store.load(join(f.base, 'state'), id).state;
  let output;
  try { output = await exec(process.execPath, [resolve('dist/cli.js'), 'resume', id, '--config', f.config, '--instructions', 'Continue the original plan. Preserve the existing tests.'], { timeout: 220000, maxBuffer: 30 * 1024 * 1024 }); }
  catch (e) { throw new Error(`Resume failed; artifacts ${f.base}\n${e.stdout?.slice(-4000)}\n${e.stderr}`); }
  const events = output.stdout.trim().split('\n').map(JSON.parse); const final = events.findLast(e => e.type === 'terminal').payload;
  assert.equal(final.status, 'succeeded'); assert.ok(final.budget.activeMs > before.budget.activeMs); assert.ok(final.budget.tokens >= before.budget.tokens);
  const after = Store.load(join(f.base, 'state'), id).state;
  assert.equal(after.originalHash, before.originalHash); assert.equal(after.amendments.length, 1); assert.ok(after.revision > before.revision);
});

test('live ambiguity stops with an explanation and no edits', { timeout: 180000 }, async () => {
  const f = fixture();
  writeFileSync(f.plan, fixturePlan('node --test', 'The owner has not decided whether add should perform numeric addition or concatenate strings. This decision is required before editing; stop with an explanation rather than choosing.'));
  let result;
  try { await exec(process.execPath, [resolve('dist/cli.js'), 'run', f.plan, '--target', f.repo, '--config', f.config], { timeout: 160000, maxBuffer: 20 * 1024 * 1024 }); assert.fail('Must stop'); } catch (e) { result = e; }
  assert.equal(result.code, 3, result.stdout?.slice(-2000));
  assert.match(readFileSync(join(f.repo, 'add.js'), 'utf8'), /a - b/);
  const final = result.stdout.trim().split('\n').map(JSON.parse).findLast(e => e.type === 'terminal').payload;
  assert.ok(final.reason.message.length > 20);
});

test('time budget stops a live request and cannot reset on resume', { timeout: 30000 }, async () => {
  const f = fixture();
  let result;
  try { await exec(process.execPath, [resolve('dist/cli.js'), 'run', f.plan, '--target', f.repo, '--config', f.config, '--max-time', '500ms'], { timeout: 15000, maxBuffer: 20 * 1024 * 1024 }); assert.fail('Must exhaust'); } catch (e) { result = e; }
  assert.equal(result.code, 4, result.stdout?.slice(-2000));
  const id = readdirSync(join(f.base, 'state/runs'))[0];
  await assert.rejects(exec(process.execPath, [resolve('dist/cli.js'), 'resume', id, '--config', f.config], { timeout: 15000 }), e => e.code === 4);
});

test('live compaction retains authoritative constraints and full history', { timeout: 180000 }, async () => {
  const f = fixture(); const c = loadConfig(f.config); const s = Store.create(c, f.repo, parsePlan(fixturePlan())); const b = new Budget(s); b.start();
  try {
    const fetcher = transport(s, b); await probe(c, fetcher, b.controller.signal);
    s.state.messages = [{ role: 'user', content: 'Preserve existing tests. The addition implementation needs fixing. '.repeat(100) }]; s.save();
    s.state.instructionContents = { 'AGENTS.md': 'EXACT CONSTRAINT: preserve arithmetic interfaces.' };
    s.state.skillContents = { 'SKILL.md': 'EXACT SKILL RULE: no additional dependencies.' };
    await compact(s, b, fetcher);
    assert.match(s.state.messages[0].content, /Preserve/);
    assert.match(s.state.messages[0].content, /EXACT CONSTRAINT: preserve arithmetic interfaces/);
    assert.match(s.state.messages[0].content, /EXACT SKILL RULE: no additional dependencies/);
    assert.ok(readdirSync(join(s.dir, 'artifacts')).some(n => n.startsWith('history-before-compaction')));
    assert.ok(s.state.budget.tokens > 0);
  } finally { b.stop(); }
});

test('live worktree run honors repository skills and nested instructions', { timeout: 240000 }, async () => {
  const f = fixture(); mkdirSync(join(f.repo, 'src'));
  renameSync(join(f.repo, 'add.js'), join(f.repo, 'src/add.js'));
  writeFileSync(join(f.repo, 'add.test.js'), readFileSync(join(f.repo, 'add.test.js'), 'utf8').replace('./add.js', './src/add.js'));
  writeFileSync(f.plan, fixturePlan().replaceAll('add.js', 'src/add.js'));
  writeFileSync(join(f.repo, 'AGENTS.md'), 'Before editing src/add.js, load the arithmetic skill. Honor nested AGENTS.md.\n');
  writeFileSync(join(f.repo, 'src/AGENTS.md'), 'Include the comment // scoped-rule in src/add.js.\n');
  mkdirSync(join(f.repo, '.agents/skills/arithmetic'), { recursive: true });
  writeFileSync(join(f.repo, '.agents/skills/arithmetic/SKILL.md'), '---\nname: arithmetic\ndescription: >\n  Instructions for arithmetic implementation changes.\n---\nInclude the comment // skill-rule in src/add.js.\n');
  await exec('git', ['init', '-b', 'main', f.repo]);
  await exec('git', ['-C', f.repo, 'add', '.']);
  await exec('git', ['-C', f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
  let output;
  try { output = await exec(process.execPath, [resolve('dist/cli.js'), 'run', f.plan, '--target', f.repo, '--worktree', '--config', f.config], { timeout: 220000, maxBuffer: 30 * 1024 * 1024 }); }
  catch (e) { throw new Error(`Worktree run failed; artifacts ${f.base}\n${e.stdout?.slice(-3000)}\n${e.stderr}`); }
  const events = output.stdout.trim().split('\n').map(JSON.parse); const final = events.findLast(e => e.type === 'terminal').payload;
  assert.equal(final.status, 'succeeded'); assert.notEqual(final.target, f.repo);
  assert.match(readFileSync(join(f.repo, 'src/add.js'), 'utf8'), /a - b/);
  const changed = readFileSync(join(final.target, 'src/add.js'), 'utf8'); assert.match(changed, /scoped-rule/); assert.match(changed, /skill-rule/);
  assert.ok(events.some(e => e.type === 'tool_result' && e.payload.name === 'load_skill' && e.payload.status === 'done'));
});
