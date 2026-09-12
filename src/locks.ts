import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash } from './plan.js';
import { atomicJSON } from './state.js';
import { Stop } from './errors.js';

export function identity(pid: number): string | undefined {
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; } catch { return undefined; }
}
export function alive(pid: number, expected?: string) {
  const current = identity(pid);
  if (current && expected) return current === expected;
  // A restricted ps is not evidence that an owner died. Keep its lock.
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
const overlap = (a: string, b: string) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
export function lock(stateDir: string, target: string, runId: string) {
  target = realpathSync(target);
  const dir = join(stateDir, 'locks'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const guard = join(dir, '.guard');
  try { mkdirSync(guard, { mode: 0o700 }); }
  catch {
    const ownerFile = join(guard, 'owner.json');
    const owner = existsSync(ownerFile) ? JSON.parse(readFileSync(ownerFile, 'utf8')) : undefined;
    if ((owner && !alive(owner.pid, owner.identity)) || (!owner && Date.now() - statSync(guard).mtimeMs > 30000)) {
      rmSync(guard, { recursive: true });
      try { mkdirSync(guard, { mode: 0o700 }); } catch { throw new Stop('locked', 'registry_busy', 'Lock registry is busy; retry.'); }
    } else throw new Stop('locked', 'registry_busy', 'Lock registry is busy; retry.');
  }
  try {
    atomicJSON(join(guard, 'owner.json'), { pid: process.pid, identity: identity(process.pid) });
    for (const name of readdirSync(dir).filter(x => x.endsWith('.json'))) {
      const path = join(dir, name); const owner = JSON.parse(readFileSync(path, 'utf8'));
      if (!overlap(target, owner.target)) continue;
      if (alive(owner.pid, owner.identity)) throw new Stop('locked', 'target_locked', `${owner.target} is owned by run ${owner.runId}`);
      // Only that run may reconcile stale actions and claim its lock.
      if (owner.runId !== runId) throw new Stop('locked', 'stale_run', `Resume run ${owner.runId} to reconcile its interrupted work before starting another run.`);
      rmSync(path);
    }
    const path = join(dir, `${hash(target)}.json`);
    atomicJSON(path, { target, runId, pid: process.pid, identity: identity(process.pid) });
    return () => { if (existsSync(path)) { const owner = JSON.parse(readFileSync(path, 'utf8')); if (owner.runId === runId && owner.pid === process.pid) rmSync(path); } };
  } finally { rmSync(guard, { recursive: true }); }
}
