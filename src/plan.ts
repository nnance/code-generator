import { createHash } from 'node:crypto';
import { Stop } from './errors.js';

export interface Criterion { id: string; title: string; kind: 'command' | 'observable'; cwd?: string; command?: string; expectedCode?: number; procedure?: string; expected: string; evidence: string; }
export interface Plan { title: string; objective: string; constraints: string; steps: { id: string; title: string; action: string; criteria: string[] }[]; criteria: Criterion[]; exit: string; source: string; hash: string; }
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
function field(block: string, name: string): string {
  const m = block.match(new RegExp(`^${name}:\\s*(.*?)(?=\\n[A-Z][A-Za-z ]*:|$(?![\\s\\S]))`, 'ms'));
  const value = m?.[1].trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export function parsePlan(source: string): Plan {
  try {
    const text = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n');
    if (/<[^>\n]+>/.test(text.replace(/```[\s\S]*?```/g, ''))) throw new Error('Replace all template placeholders');
    if (!/^Plan format: 1\s*$/m.test(text)) throw new Error('Expected Plan format: 1');
    const title = text.match(/^# Implementation Plan: (.+)$/m)?.[1];
    if (!title) throw new Error('Expected # Implementation Plan: title');
    const section = (name: string) => {
      const matches = [...text.matchAll(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'gm'))];
      if (matches.length !== 1 || !matches[0][1].trim()) throw new Error(`Expected one nonempty ${name} section`);
      return matches[0][1].trim();
    };
    const steps = [...section('Ordered steps').matchAll(/^### Step (S\d+): (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)].map(m => ({ id: m[1], title: m[2], action: field(m[3], 'Action'), criteria: field(m[3], 'Acceptance criteria').split(/[,\s]+/).filter(Boolean) }));
    const criteria = [...section('Acceptance criteria').matchAll(/^### (AC\d+): (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)].map(m => {
      const kind = field(m[3], 'Kind');
      if (kind !== 'command' && kind !== 'observable') throw new Error(`Invalid kind for ${m[1]}`);
      const c: Criterion = { id: m[1], title: m[2], kind, expected: field(m[3], 'Expected result'), evidence: field(m[3], 'Evidence') };
      if (kind === 'command') {
        c.cwd = field(m[3], 'Working directory');
        c.command = field(m[3], 'Command').match(/^```(?:sh|bash)?\n([\s\S]*?)\n```$/)?.[1];
        if (!c.command || /<[^>\n]+>/.test(c.command)) throw new Error(`Invalid command for ${c.id}`);
        c.expectedCode = Number(field(m[3], 'Expected exit code'));
        if (!Number.isInteger(c.expectedCode) || c.expectedCode < 0 || c.expectedCode > 255) throw new Error(`Invalid exit code for ${c.id}`);
      } else c.procedure = field(m[3], 'Procedure');
      return c;
    });
    if (!steps.length || !criteria.length) throw new Error('At least one step and acceptance criterion are required');
    for (const list of [steps, criteria]) if (new Set(list.map(x => x.id)).size !== list.length) throw new Error('Duplicate IDs');
    for (const s of steps) for (const id of s.criteria) if (!criteria.some(c => c.id === id)) throw new Error(`Unknown criterion ${id}`);
    const exit = section('Exit criteria');
    if (!/every.*step/i.test(exit) || !/every.*acceptance criterion/i.test(exit) || !/no unresolved/i.test(exit)) throw new Error('Exit criteria must require every step, every acceptance criterion, and no unresolved blockers');
    return { title, objective: section('Objective'), constraints: section('Scope and constraints'), steps, criteria, exit, source, hash: hash(source) };
  } catch (e) { throw new Stop('invalid_input', 'invalid_plan', `Invalid plan: ${e instanceof Error ? e.message : e}`); }
}
