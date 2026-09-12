import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, atomicJSON, type ProcessRecord } from './state.js';
import { Budget } from './budget.js';
import { identity } from './locks.js';
import { Stop } from './errors.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export class Processes {
  constructor(public store: Store, public budget: Budget) {}
  async start(id: string, command: string, cwd: string, background: boolean, timeout: number) {
    const prefix = join(this.store.dir, 'artifacts', id);
    const record: ProcessRecord = { id, command, cwd, background, resultFile: prefix + '.result.json', stdout: prefix + '.stdout', stderr: prefix + '.stderr' };
    this.store.state.processes[id] = record; this.store.save();
    atomicJSON(prefix + '.command.json', { command, cwd, stdout: record.stdout, stderr: record.stderr, result: record.resultFile, ready: prefix + '.ready.json', start: prefix + '.start', timeout, grace: this.store.state.config.shutdownGraceMs });
    const child = spawn(process.execPath, [fileURLToPath(new URL('./supervisor.js', import.meta.url)), prefix + '.command.json'], { detached: true, stdio: 'ignore' });
    child.unref(); record.pid = child.pid; record.identity = child.pid ? identity(child.pid) : undefined; this.store.save();
    let startError: Error | undefined; child.on('error', e => { startError = e; });
    for (let tries = 0; !existsSync(prefix + '.ready.json'); tries++) {
      if (startError) throw startError;
      this.budget.check(); if (tries > 100) throw new Stop('blocked', 'process_start_failed', 'Supervisor did not become ready.'); await sleep(50);
    }
    const ready = JSON.parse(readFileSync(prefix + '.ready.json', 'utf8')); record.pid = ready.pid; record.identity = ready.identity; this.store.save();
    this.budget.check(); writeFileSync(prefix + '.start', 'start', { mode: 0o600 });
    if (background) return { processId: id, running: true, stdout: record.stdout, stderr: record.stderr };
    while (!existsSync(record.resultFile)) { this.budget.check(); await sleep(100); }
    return this.result(record);
  }
  result(record: ProcessRecord) {
    const outcome = existsSync(record.resultFile) ? JSON.parse(readFileSync(record.resultFile, 'utf8')) : { running: true };
    return { processId: record.id, ...outcome, stdout: record.stdout, stderr: record.stderr,
      stdoutTail: existsSync(record.stdout) ? readFileSync(record.stdout, 'utf8').slice(-16000) : '',
      stderrTail: existsSync(record.stderr) ? readFileSync(record.stderr, 'utf8').slice(-16000) : '' };
  }
  async stop(record: ProcessRecord) {
    if (!record.pid) {
      const ready = join(this.store.dir, 'artifacts', record.id + '.ready.json');
      if (existsSync(ready)) Object.assign(record, JSON.parse(readFileSync(ready, 'utf8')));
    }
    if (!record.pid || !record.identity || identity(record.pid) !== record.identity) return;
    try { process.kill(-record.pid, 'SIGTERM'); } catch { return; }
    const end = Date.now() + this.store.state.config.shutdownGraceMs;
    while (identity(record.pid) === record.identity && Date.now() < end) await sleep(100);
    if (identity(record.pid) === record.identity) { try { process.kill(-record.pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
  async cleanup() { for (const record of Object.values(this.store.state.processes)) await this.stop(record); }
}
