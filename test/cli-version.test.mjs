import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const cli = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'cli.js');
const packageJson = JSON.parse(readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'package.json'), 'utf8'));
const expected = `${packageJson.version}\n`;

function runCli(args, cwd = process.cwd()) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  assert.equal(result.stderr, '', 'stderr must be empty');
  return result.stdout;
}

test('--version prints the package.json version plus newline and exits 0', () => {
  assert.equal(runCli(['--version']), expected);
});

test('--version wins over --help', () => {
  assert.equal(runCli(['--version', '--help']), expected);
});

test('--version works from an unrelated cwd using the executable-relative package.json', () => {
  assert.equal(runCli(['--version'], tmpdir()), expected);
});

test('--version ignores --config pointing to a nonexistent file and --base-url', () => {
  assert.equal(runCli(['--version', '--config', 'no-such-config.json', '--base-url', 'http://127.0.0.1:1/v1']), expected);
});

test('--help lists --version', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--version/);
});