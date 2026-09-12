import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { Store } from './state.js';
import { Budget } from './budget.js';
import { Processes } from './processes.js';
import { targetPath, files, instructions, skills, within } from './repository.js';
import { hash } from './plan.js';
import { checkCommand } from './policy.js';
import { Stop } from './errors.js';

export class CodingTools {
  processes: Processes;
  queue: Promise<unknown> = Promise.resolve();
  stop?: Stop;
  constructor(public store: Store, public budget: Budget) { this.processes = new Processes(store, budget); }
  async action(name: string, input: unknown, fn: (id: string) => unknown | Promise<unknown>) {
    const perform = async () => {
      this.budget.check(); if (this.stop) throw this.stop;
      const a = this.store.intent(name, input);
      try { const output = await fn(a.id); this.store.complete(a, output); return { actionId: a.id, ...(output && typeof output === 'object' ? output : { output }) }; }
      catch (e) { this.store.fail(a, e); if (e instanceof Stop) { this.stop = e; this.budget.controller.abort(e); } throw e; }
    };
    const result = this.queue.then(perform); this.queue = result.catch(() => {}); return result;
  }
  guidance(path: string) { return instructions(this.store, path); }
  async shell(command: string, cwd: string, background = false, timeout?: number) {
    const dir = targetPath(this.store.state.target, cwd);
    return this.action('shell', { command, cwd: dir, background }, async id => {
      checkCommand(command, this.store.state.config, [this.store.state.plan.source, ...this.store.state.amendments.map(a => a.text)].join('\n'));
      const guidance = this.guidance(dir);
      const result = await this.processes.start(id, command, dir, background, timeout ?? this.store.state.config.commandTimeoutMs);
      return { ...result, instructions: guidance };
    });
  }
  definitions() {
    const root = this.store.state.target;
    return {
      read: tool({ description: 'Read text file lines. Also reads retained artifacts by absolute path. Read scoped instructions before editing.', inputSchema: z.object({ path: z.string(), start: z.number().int().positive().default(1), lines: z.number().int().positive().max(1000).default(200) }), execute: input => this.action('read', input, () => {
        const artifact = input.path.startsWith(this.store.dir + '/artifacts/');
        const p = targetPath(artifact ? this.store.dir : root, input.path);
        const text = readFileSync(p, 'utf8'); if (text.includes('\0')) return { binary: true, bytes: Buffer.byteLength(text) };
        const lines = text.split('\n'); return { path: p, hash: hash(text), totalLines: lines.length, content: lines.slice(input.start - 1, input.start - 1 + input.lines).map((l, i) => `${input.start + i}: ${l}`).join('\n'), instructions: artifact ? [] : this.guidance(p) };
      }) }),
      list: tool({ description: 'List repository files, optionally filter with a glob (*, **, ?).', inputSchema: z.object({ glob: z.string().default('**'), offset: z.number().int().min(0).default(0) }), execute: input => this.action('list', input, () => {
        const re = new RegExp('^' + input.glob.split('**').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.')).join('.*') + '$');
        const paths = files(root).filter(p => re.test(p)); return { paths: paths.slice(input.offset, input.offset + 500), total: paths.length, instructions: this.guidance(root) };
      }) }),
      grep: tool({ description: 'Search repository text using a literal or regular expression. Returns file and line references.', inputSchema: z.object({ pattern: z.string(), regex: z.boolean().default(false), pathIncludes: z.string().default(''), offset: z.number().int().min(0).default(0) }), execute: input => this.action('grep', input, () => {
        const re = input.regex ? new RegExp(input.pattern) : undefined; const results: { path: string; line: number; text: string }[] = [];
        for (const p of files(root).filter(p => p.includes(input.pathIncludes))) {
          const text = readFileSync(join(root, p), 'utf8'); if (text.includes('\0')) continue;
          text.split('\n').forEach((line, i) => { if (re ? re.test(line) : line.includes(input.pattern)) results.push({ path: p, line: i + 1, text: line }); });
        }
        const artifact = this.store.artifact('grep', results); return { matches: results.slice(input.offset, input.offset + 200), total: results.length, artifact };
      }) }),
      write: tool({ description: 'Create or replace a UTF-8 file. Existing files require their exact SHA256 from read; use null only for new files. Read scoped AGENTS.md first.', inputSchema: z.object({ path: z.string(), content: z.string(), expectedHash: z.string().nullable() }), execute: input => {
        const p = targetPath(root, input.path, true); const before = existsSync(p) ? hash(readFileSync(p)) : null;
        return this.action('write', { ...input, path: p, beforeHash: before, afterHash: hash(input.content) }, () => {
          const current = existsSync(p) ? hash(readFileSync(p)) : null;
          if (current !== input.expectedHash) throw new Error('File changed or expectedHash missing. Read it again before writing.');
          const guidance = this.guidance(p); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, input.content);
          return { path: p, hash: hash(input.content), instructions: guidance };
        });
      } }),
      shell: tool({ description: 'Execute a non-interactive shell command with captured output. All commands obey policy. Background commands return a process ID.', inputSchema: z.object({ command: z.string(), cwd: z.string().default('.'), background: z.boolean().default(false), timeoutMs: z.number().positive().optional() }), execute: i => this.shell(i.command, i.cwd, i.background, i.timeoutMs) }),
      process: tool({ description: 'Inspect or stop an owned background process.', inputSchema: z.object({ id: z.string(), operation: z.enum(['inspect', 'stop']) }), execute: i => this.action('process', i, async () => {
        const record = this.store.state.processes[i.id]; if (!record) throw new Error('Unknown process ID');
        if (i.operation === 'stop') await this.processes.stop(record); return this.processes.result(record);
      }) }),
      load_skill: tool({ description: 'Load a repository skill by its discovered name.', inputSchema: z.object({ name: z.string() }), execute: i => this.action('load_skill', i, () => {
        const skill = skills(root).find(s => s.name === i.name); if (!skill) throw new Error('Unknown skill');
        const content = readFileSync(skill.path, 'utf8'); this.store.state.skills[skill.path] = hash(content); return { ...skill, content };
      }) }),
      progress: tool({ description: 'Record step status and evidence action IDs. Completed steps must reference successful prior tool actions.', inputSchema: z.object({ step: z.string(), status: z.enum(['in_progress', 'completed', 'blocked']), explanation: z.string().min(1), actions: z.array(z.string()) }), execute: i => this.action('progress', i, () => {
        const step = this.store.state.steps[i.step]; if (!step) throw new Error('Unknown plan step');
        if (i.status === 'completed' && (!i.actions.length || i.actions.some(id => this.store.state.actions[id]?.status !== 'done'))) throw new Error('Completion requires valid successful action IDs as evidence.');
        step.status = i.status; step.evidence = { explanation: i.explanation, actions: i.actions, revision: this.store.state.revision }; return { step: i.step, ...step };
      }) }),
      blocked: tool({ description: 'Stop with an explanation when a decision, prerequisite, or ambiguity prevents safe progress.', inputSchema: z.object({ reason: z.string().min(1) }), execute: i => this.action('blocked', i, () => { throw new Stop('blocked', 'agent_blocker', i.reason); }) }),
    };
  }
  async recover() {
    await this.processes.cleanup();
    for (const a of Object.values(this.store.state.actions).filter(a => a.status === 'pending')) {
      const input = a.input as Record<string, string>;
      if (a.name === 'write') {
        const current = existsSync(input.path) ? hash(readFileSync(input.path)) : null;
        if (current === input.afterHash) { this.store.complete(a, { recovered: true, path: input.path, hash: current }); continue; }
        if (current === input.beforeHash) { this.store.fail(a, 'Interrupted before write; unchanged file. Safe to retry.'); continue; }
      } else if (a.name === 'shell') {
        const record = this.store.state.processes[a.id];
        if (record && existsSync(record.resultFile)) { this.store.complete(a, this.processes.result(record)); continue; }
        const marker = join(this.store.dir, 'artifacts', a.id + '.start');
        if (!existsSync(marker)) { this.store.fail(a, 'Command never authorized to start; safe to retry.'); continue; }
      } else if (['read', 'list', 'grep', 'load_skill', 'progress', 'process'].includes(a.name)) { this.store.fail(a, 'Interrupted operation; safe to inspect again.'); continue; }
      throw new Stop('blocked', 'uncertain_action', `Cannot determine outcome of ${a.name} action ${a.id}. Inspect retained output and resolve it explicitly before resume.`);
    }
    // Reject artifact paths that escaped storage if state was externally corrupted.
    for (const p of Object.values(this.store.state.processes)) if (!within(this.store.dir, p.resultFile)) throw new Stop('internal_error', 'state_corrupt', 'Process artifact path escaped run directory');
  }
}
