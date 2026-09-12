import { readFileSync, existsSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, relative, dirname, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from './state.js';
import { hash } from './plan.js';
import { Stop } from './errors.js';
import { parseDocument } from 'yaml';

export function within(root: string, path: string) { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !rel.startsWith(sep)); }
export function globRegex(pattern: string) {
  let result = '^';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.slice(i, i + 3) === '**/') { result += '(?:.*/)?'; i += 2; }
    else if (pattern.slice(i, i + 2) === '**') { result += '.*'; i++; }
    else if (pattern[i] === '*') result += '[^/]*';
    else if (pattern[i] === '?') result += '[^/]';
    else result += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(result + '$');
}
export function targetPath(root: string, path: string, allowMissing = false) {
  const full = resolve(root, path); let check = full;
  if (allowMissing) while (!existsSync(check) && dirname(check) !== check) check = dirname(check);
  const canonical = resolve(realpathSync(check), relative(check, full));
  if (!within(realpathSync(root), canonical)) throw new Stop('blocked', 'path_outside_target', `Path is outside target: ${path}`);
  return canonical;
}
export function files(root: string, exclude = new Set(['.git', 'node_modules', '.code-generator'])): string[] {
  const out: string[] = [];
  function walk(dir: string) { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (exclude.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else if (entry.isFile()) out.push(relative(root, path));
  } }
  walk(root); return out;
}
export function fileSnapshot(root: string) { return Object.fromEntries(files(root).map(p => [p, hash(readFileSync(join(root, p)))])); }
export function gitState(root: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 20 * 1024 * 1024 });
  try { return { head: git('rev-parse', 'HEAD').trim(), branch: git('branch', '--show-current').trim(), status: git('status', '--porcelain=v1'), diff: git('diff', 'HEAD'), untracked: git('ls-files', '--others', '--exclude-standard') }; } catch { return undefined; }
}
export function instructions(store: Store, path = store.state.target) {
  const root = store.state.target; const full = targetPath(root, path, true);
  let dir = existsSync(full) && lstatSync(full).isDirectory() ? full : dirname(full);
  const dirs = [];
  while (within(root, dir)) { dirs.unshift(dir); if (dir === root) break; dir = dirname(dir); }
  const out = [];
  for (const d of dirs) {
    const p = join(d, 'AGENTS.md'); if (!existsSync(p)) continue;
    targetPath(root, p); const content = readFileSync(p, 'utf8'); out.push({ path: relative(root, p), content });
    if (store.state.instructions[p] !== hash(content)) {
      store.state.instructions[p] = hash(content); (store.state.instructionContents ??= {})[p] = content; store.event('instructions', { path: p, content }); store.save();
    }
  }
  return out;
}
export interface Skill { name: string; description: string; path: string; }
export function skills(root: string): Skill[] {
  const dir = join(root, '.agents/skills'); if (!existsSync(dir)) return [];
  targetPath(root, dir);
  const result: Skill[] = [];
  for (const file of files(dir, new Set())) {
    if (file.split(sep).at(-1) !== 'SKILL.md') continue;
    const path = join(dir, file); const source = readFileSync(path, 'utf8'); const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const doc = parseDocument(front ?? '');
    const metadata = doc.toJS({ maxAliasCount: 20 });
    const name = metadata?.name, description = metadata?.description;
    if (doc.errors.length || typeof name !== 'string' || !name.trim() || typeof description !== 'string' || !description.trim()) throw new Stop('invalid_input', 'invalid_skill', `Skill ${path} requires valid name and description metadata.`);
    if (result.some(s => s.name === name)) throw new Stop('invalid_input', 'duplicate_skill', `Duplicate skill name: ${name}`);
    result.push({ name, description, path });
  }
  return result;
}
