// A detached wrapper writes command results even if the agent process dies.
import { readFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
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
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_PAGER: 'cat', PAGER: 'cat' };
  // Node's test harness marks descendants; inheriting this would make a nested
  // `node --test` exit successfully without actually running the target tests.
  delete env.NODE_TEST_CONTEXT; delete env.NODE_TEST_WORKER_ID;
  const child = spawn('/bin/sh', ['-c', spec.command], { cwd: spec.cwd, stdio: ['ignore', stdout, stderr], env });
  let timedOut = false;
  let shutdown: NodeJS.Timeout | undefined;
  const killGroup = () => { try { process.kill(-process.pid, 'SIGKILL'); } catch { /* gone */ } };
  const terminate = () => {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    shutdown ??= setTimeout(killGroup, spec.grace);
  };
  process.on('SIGTERM', terminate); process.on('SIGINT', terminate);
  const timer = setTimeout(() => { timedOut = true; terminate(); }, spec.timeout);
  child.on('error', error => { atomicJSON(spec.result, { code: null, error: error.message, durationMs: Date.now() - start }); clearTimeout(timer); });
  child.on('close', (code, signal) => {
    atomicJSON(spec.result, { code, signal, timedOut, durationMs: Date.now() - start }); clearTimeout(timer); closeSync(stdout); closeSync(stderr);
    let descendants = true;
    try {
      descendants = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,stat=,ppid='], { encoding: 'utf8' }).trim().split('\n').some(line => {
        const [pid, group, status, parent] = line.trim().split(/\s+/);
        // Exclude this inspection's own ps child from the group inventory.
        return Number(group) === process.pid && Number(pid) !== process.pid && Number(parent) !== process.pid && !status.startsWith('Z');
      });
    } catch { /* Without process visibility, keep the group leader for safe cleanup. */ }
    if (descendants) shutdown ??= setTimeout(killGroup, spec.grace);
    else { clearTimeout(shutdown); process.exit(0); }
  });
}
