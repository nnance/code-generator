import { readFileSync, realpathSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, duration, type Config } from './config.js';
import { parsePlan, hash } from './plan.js';
import { Store, atomicJSON } from './state.js';
import { lock, alive, identity } from './locks.js';
import { Budget } from './budget.js';
import { probe } from './model.js';
import { transport } from './transport.js';
import { CodingTools } from './tools.js';
import { executeAgent } from './agent.js';
import { gitState, fileSnapshot, skills, instructions, within, targetPath } from './repository.js';
import { failure, exitCodes, Stop } from './errors.js';
import { amend, resolveActions } from './amend.js';
import { assess } from './assess.js';

export interface Options { config?: string; target?: string; worktree?: boolean; instructions?: string; 'max-time'?: string; 'max-tokens'?: string; 'base-url'?: string; model?: string; output?: string; json?: boolean; }
function overrides(o: Options) {
  const result: Record<string, unknown> = {};
  if (o['max-time']) result.maxTimeMs = duration(o['max-time']);
  if (o['max-tokens']) result.maxTokens = Number(o['max-tokens']);
  if (o['base-url']) result.baseURL = o['base-url']; if (o.model) result.model = o.model;
  if (o.output || o.json) result.output = o.json ? 'json' : o.output;
  return result;
}
function emitter(format: Config['output']) {
  return (event: Record<string, unknown>) => {
    if (format === 'json') process.stdout.write(JSON.stringify(event) + '\n');
    else if (event.type === 'model_delta') process.stdout.write((event.payload as { text: string }).text);
    else if (event.type !== 'checkpoint') {
      const p = event.payload as Record<string, unknown>;
      const detail = event.type === 'tool_intent' ? `${p.name} ${JSON.stringify(p.input).slice(0, 250)}` : event.type === 'tool_result' ? `${p.name} ${p.status}` : JSON.stringify(p).slice(0, 700);
      process.stdout.write(`\n[${event.type}] ${detail}\n`);
    }
  };
}
export async function runtime(command: string, argument: string | undefined, options: Options): Promise<number> {
  if (!['run', 'resume', 'status', 'inspect'].includes(command)) throw new Stop('invalid_input', 'unknown_command', `Unknown command ${command}`);
  if (command !== 'status' && !argument) throw new Stop('invalid_input', 'missing_argument', `${command} requires an argument`);
  const config = loadConfig(options.config, overrides(options));
  if (command === 'status' || command === 'inspect') {
    const ids = argument ? [argument] : Store.list(config.stateDir);
    const records = ids.map(id => { const s = Store.load(config.stateDir, id); const stale = s.state.status === 'running' && (!s.state.owner || !alive(s.state.owner.pid, s.state.owner.identity)); return command === 'inspect' ? { ...s.state, stale } : { id, status: stale ? 'interrupted' : s.state.status, stale, target: s.state.target, budget: s.state.budget, steps: s.state.steps, reason: s.state.reason }; });
    process.stdout.write(JSON.stringify(argument ? records[0] : records, null, options.json || config.output === 'json' ? undefined : 2) + '\n'); return 0;
  }
  let store: Store;
  if (command === 'resume') {
    if (options.target || options.worktree) throw new Stop('invalid_input', 'resume_target', 'Resume uses the recorded target/worktree.');
    store = Store.load(config.stateDir, argument!);
    if (store.state.status === 'succeeded') throw new Stop('invalid_input', 'already_completed', 'This run succeeded. Start a new run for new work.');
    store.state.config = loadConfig(options.config, overrides(options), store.state.config);
  } else {
    let target: string;
    try { target = realpathSync(resolve(options.target ?? '.')); if (!statSync(target).isDirectory()) throw new Error('not a directory'); }
    catch { throw new Stop('invalid_input', 'invalid_target', 'Target must be an existing local directory.'); }
    let source: string;
    try { source = readFileSync(resolve(argument!), 'utf8'); } catch { throw new Stop('invalid_input', 'missing_plan', `Cannot read ${argument}`); }
    const plan = parsePlan(source); skills(target);
    if (within(target, config.stateDir)) throw new Stop('invalid_input', 'state_inside_target', 'Central state directory must be outside the target.');
    store = Store.create(config, target, plan);
  }
  store.emit = emitter(store.state.config.output);
  if (command === 'resume' && store.state.sourceTarget !== store.state.target) {
    const releaseSource = lock(store.state.config.stateDir, store.state.sourceTarget, store.state.id); releaseSource();
  }
  const release = lock(store.state.config.stateDir, store.state.target, store.state.id);
  store.repairTail();
  const budget = new Budget(store); const coding = new CodingTools(store, budget);
  let started = false; let code = 0; let worktreeRelease: (() => void) | undefined;
  const interrupt = (signal: 'SIGINT' | 'SIGTERM') => { code = signal === 'SIGTERM' ? 143 : 130; budget.controller.abort(new Stop('interrupted', signal, `Interrupted by ${signal}`)); };
  const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  try {
    budget.start(); started = true; store.state.status = 'running'; store.state.owner = { pid: process.pid, identity: identity(process.pid) }; delete store.state.reason;
    store.event(command === 'resume' ? 'run_resume' : 'run_start', { id: store.state.id, target: store.state.target });
    if (command === 'resume') {
      if (options.instructions) resolveActions(store, options.instructions);
      const previousTarget = store.state.target;
      await coding.recover();
      if (store.state.target !== previousTarget) { store.state.target = realpathSync(store.state.target); worktreeRelease = lock(store.state.config.stateDir, store.state.target, store.state.id); release(); }
      instructions(store);
      for (const p of Object.keys(store.state.instructions)) {
        if (existsSync(p)) instructions(store, p);
        else { delete store.state.instructions[p]; delete store.state.instructionContents?.[p]; store.event('instructions_removed', { path: p }); }
      }
      for (const p of Object.keys(store.state.skills)) {
        if (existsSync(p)) {
          const checked = targetPath(store.state.target, p);
          if (!within(join(store.state.target, '.agents/skills'), checked)) throw new Stop('invalid_input', 'skill_escape', 'Loaded skill escaped .agents/skills');
          const content = readFileSync(checked, 'utf8'); store.state.skills[p] = hash(content); (store.state.skillContents ??= {})[p] = content;
        }
        else { delete store.state.skills[p]; delete store.state.skillContents?.[p]; }
      }
      if (options.instructions) {
        store.state.amendments.push({ text: options.instructions, time: new Date().toISOString() });
        store.state.messages.push({ role: 'user', content: `Explicit resume amendment: ${options.instructions}\nReassess all affected work and record fresh evidence. Do not relax acceptance criteria unless explicitly directed.` });
        store.event('amendment', store.state.amendments.at(-1));
      }
      store.state.messages.push({ role: 'user', content: `Resume recovered state (these instructions supersede older snapshots): ${JSON.stringify({ steps: store.state.steps, actions: Object.values(store.state.actions).slice(-20), instructions: store.state.instructionContents, loadedSkills: store.state.skillContents, skills: skills(store.state.target) })}` });
    }
    store.save();
    const fetcher = transport(store, budget); const capabilities = await probe(store.state.config, fetcher, budget.controller.signal);
    store.event('preflight', { model: capabilities.model, usage: capabilities.usage });
    if (command === 'resume' && options.instructions) await amend(store, budget, fetcher, options.instructions);
    await assess(store, budget, fetcher);
    if (options.worktree) {
      const git = gitState(store.state.target);
      if (!git || git.status.trim()) throw new Stop('invalid_input', 'worktree_requires_clean_git', 'Worktree mode requires a clean Git checkout with a commit.');
      const path = join(store.state.config.stateDir, 'worktrees', store.state.id); mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
      const a = store.intent('worktree', { path, source: store.state.target });
      execFileSync('git', ['-C', store.state.target, 'worktree', 'add', '-b', `code-generator/${store.state.id}`, path, 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] });
      store.state.target = realpathSync(path); store.complete(a, { path }); worktreeRelease = lock(store.state.config.stateDir, store.state.target, store.state.id); release();
    }
    if (command === 'run') { store.state.initialGit = gitState(store.state.target); store.state.initialFiles = fileSnapshot(store.state.target); store.save(); }
    const result = await executeAgent(store, budget, coding, fetcher);
    store.state.status = 'succeeded'; store.event('completion', result);
  } catch (e) {
    const err = failure(budget.controller.signal.aborted ? budget.controller.signal.reason : e);
    store.state.status = err.category; store.state.reason = { code: err.reason, message: err.message }; code ||= exitCodes[err.category];
  } finally {
    await coding.processes.cleanup();
    if (started) budget.stop();
    store.save();
    const current = fileSnapshot(store.state.target);
    const changes = [...new Set([...Object.keys(store.state.initialFiles ?? {}), ...Object.keys(current)])].filter(p => store.state.initialFiles?.[p] !== current[p]);
    const report = { id: store.state.id, status: store.state.status, target: store.state.target, reason: store.state.reason, steps: store.state.steps, budget: store.state.budget, verification: store.state.verification, git: gitState(store.state.target), changes, artifacts: store.dir,
      resume: store.state.status === 'succeeded' ? undefined : `code-generator resume ${store.state.id}`, pending: Object.values(store.state.actions).filter(a => a.status === 'pending') };
    atomicJSON(join(store.dir, 'report.json'), report);
    writeFileSync(join(store.dir, 'report.md'), `# Run ${report.id}\n\nStatus: ${report.status}\n\n${report.reason?.message ?? 'All acceptance criteria passed.'}\n\n## Steps\n\n${Object.entries(report.steps).map(([id, s]) => `- ${id}: ${s.status}${s.evidence ? ' — ' + s.evidence.explanation : ''}`).join('\n')}\n\n## Changed paths\n\n${changes.map(p => '- ' + p).join('\n') || 'None'}\n\nActive time: ${Math.round(report.budget.activeMs)} ms. Tokens: ${report.budget.tokens} (${report.budget.uncertainTokens} uncertain).\n\nArtifacts: ${report.artifacts}\n\n${report.resume ? 'Resume: `' + report.resume + '`\n' : ''}`, { mode: 0o600 });
    store.event('terminal', report);
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); worktreeRelease?.(); release();
  }
  return code;
}
