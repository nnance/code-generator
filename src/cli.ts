#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { failure, exitCodes, Stop } from './errors.js';
import { runtime } from './runtime.js';

export const help = `Code Generator — autonomous implementation plans

Usage:
  code-generator run <plan.md> [--target <directory>] [--worktree]
  code-generator resume <run-id> [--instructions <text>]
  code-generator status [run-id] [--json]
  code-generator inspect <run-id> [--json]

Options:
  --config <path>       User JSON configuration
  --max-time <duration> Total active-time allowance (default 1h; ms/s/m/h)
  --max-tokens <count>  Total input + output token allowance
  --base-url <url>      OpenAI-compatible API base URL
  --model <id>          Served model identifier
  --output human|json  Streaming format (default human)
  --help               Show this help

Resume retains consumed budgets; overrides replace totals, not remaining time.
Exit codes: 0 success; 2 input; 3 blocker; 4 budget; 5 internal; 6 locked;
130 SIGINT; 143 SIGTERM.
`;
export function args() {
  return parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, json: { type: 'boolean' }, worktree: { type: 'boolean' },
    target: { type: 'string' }, config: { type: 'string' }, instructions: { type: 'string' },
    'max-time': { type: 'string' }, 'max-tokens': { type: 'string' },
    'base-url': { type: 'string' }, model: { type: 'string' }, output: { type: 'string' },
  } });
}
try {
  let input;
  try { input = args(); } catch (e) { throw new Stop('invalid_input', 'invalid_arguments', e instanceof Error ? e.message : String(e)); }
  if (input.values.help || !input.positionals.length) process.stdout.write(help);
  else {
    if (input.positionals.length > 2) throw new Stop('invalid_input', 'invalid_arguments', 'Too many positional arguments. Use --instructions for resume text.');
    process.exitCode = await runtime(input.positionals[0], input.positionals[1], input.values);
  }
} catch (e) {
  const err = failure(e); process.stderr.write(`${err.reason}: ${err.message}\n`); process.exitCode = exitCodes[err.category];
}
