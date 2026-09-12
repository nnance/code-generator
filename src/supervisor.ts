// A detached wrapper writes command results even if the agent process dies.
import { readFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { atomicJSON } from './state.js';
import { identity } from './locks.js';

const path = process.argv[2];
if (path) {
  const spec = JSON.parse(readFileSync(path, 'utf8'));
  atomicJSON(spec.ready, { pid: process.pid, identity: identity(process.pid) });
  let wait = 0;
  while (!existsSync(spec.start)) {
    if (++wait > 300) process.exit(0);
    await new Promise(r => setTimeout(r, 100));
  }
  const stdout = openSync(spec.stdout, 'a', 0o600), stderr = openSync(spec.stderr, 'a', 0o600);
  const start = Date.now();
  const child = spawn('/bin/sh', ['-c', spec.command], { cwd: spec.cwd, stdio: ['ignore', stdout, stderr], env: { ...process.env, CI: '1', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_PAGER: 'cat', PAGER: 'cat' } });
  let timedOut = false;
  const terminate = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
  process.on('SIGTERM', terminate); process.on('SIGINT', terminate);
  const timer = setTimeout(() => { timedOut = true; terminate(); setTimeout(() => { try { process.kill(-process.pid, 'SIGKILL'); } catch { /* gone */ } }, spec.grace).unref(); }, spec.timeout);
  child.on('error', error => { atomicJSON(spec.result, { code: null, error: error.message, durationMs: Date.now() - start }); clearTimeout(timer); });
  child.on('close', (code, signal) => {
    atomicJSON(spec.result, { code, signal, timedOut, durationMs: Date.now() - start }); clearTimeout(timer); closeSync(stdout); closeSync(stderr);
    process.exitCode = 0;
  });
}
