import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../dist/config.js';
import { checkCommand } from '../dist/policy.js';
import { skills, targetPath, globRegex } from '../dist/repository.js';

test('recursive globs include both root files and nested files', () => {
  assert.ok(globRegex('**/*.js').test('add.js'));
  assert.ok(globRegex('**/*.js').test('src/add.js'));
  assert.ok(!globRegex('*.js').test('src/add.js'));
});

test('denylist catches destructive variants and requires delivery authorization', () => {
  const c = loadConfig();
  for (const cmd of ['rm -rf *', 'rm -r -f ./build/*', 'rm --recursive /', 'git reset --hard HEAD', 'git clean -fd']) assert.throws(() => checkCommand(cmd, c, ''), /blocked/);
  for (const cmd of ['npm test', 'rm temporary.txt', 'git status']) assert.doesNotThrow(() => checkCommand(cmd, c, ''));
  assert.throws(() => checkCommand('git push origin main', c, 'Do not push.'), /explicit instruction/);
  assert.doesNotThrow(() => checkCommand('git commit -m fix', c, 'Commit the finished changes.'));
});
test('skill discovery is repository-local and paths cannot escape', () => {
  const root = mkdtempSync(join(tmpdir(), 'codegen-tools-'));
  for (const base of ['.agents/skills/a', '.codex/skills/b']) { mkdirSync(join(root, base), { recursive: true }); writeFileSync(join(root, base, 'SKILL.md'), `---\nname: ${base.endsWith('a') ? 'a' : 'b'}\ndescription: A skill\n---\nInstructions`); }
  assert.deepEqual(skills(root).map(s => s.name), ['a']);
  assert.throws(() => targetPath(root, '../escape', true), /outside target/);
});
