import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Stop } from './errors.js';

export const configSchema = z.object({
  version: z.literal(1).default(1),
  baseURL: z.string().url().default('http://127.0.0.1:8001/v1'),
  model: z.string().min(1).default('qwen3.6-35b-8bit'),
  apiKeyEnv: z.string().optional(),
  stateDir: z.string().default(resolve(homedir(), '.code-generator')),
  maxTimeMs: z.number().positive().nullable().default(3_600_000),
  maxTokens: z.number().int().positive().nullable().default(null),
  contextTokens: z.number().int().positive().default(262144),
  maxOutputTokens: z.number().int().positive().default(4096),
  compactionThreshold: z.number().min(0.1).max(0.95).default(0.8),
  commandTimeoutMs: z.number().positive().default(120000),
  apiTimeoutMs: z.number().positive().default(300000),
  shutdownGraceMs: z.number().positive().default(5000),
  retries: z.number().int().min(0).max(5).default(2),
  noProgressLimit: z.number().int().min(1).default(3),
  output: z.enum(['human', 'json']).default('human'),
  denylist: z.array(z.object({ id: z.string().min(1), pattern: z.string().min(1), reason: z.string().min(1) })).default([]),
  providerOptions: z.record(z.string(), z.record(z.string(), z.json())).default({}),
}).strict().superRefine((c, ctx) => {
  if (c.maxTimeMs === null && c.maxTokens === null) ctx.addIssue({ code: 'custom', message: 'At least one finite time or token limit is required.' });
  if (c.maxOutputTokens >= c.contextTokens) ctx.addIssue({ code: 'custom', message: 'Output allowance must be smaller than model context.' });
  for (const r of c.denylist) { try { new RegExp(r.pattern); } catch { ctx.addIssue({ code: 'custom', message: `Invalid denylist regex: ${r.id}` }); } }
});
export type Config = z.infer<typeof configSchema>;
export function duration(text: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text);
  if (!m) throw new Stop('invalid_input', 'invalid_duration', 'Use a positive duration such as 500ms, 30s, 10m, or 1h.');
  const value = Number(m[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]]!);
  if (!Number.isFinite(value) || value <= 0) throw new Stop('invalid_input', 'invalid_duration', 'Duration must be finite and positive.');
  return value;
}
export function loadConfig(path?: string, overrides: Record<string, unknown> = {}, saved?: Config): Config {
  const file = path ? resolve(path) : resolve(homedir(), '.code-generator/config.json');
  try {
    if (path && !existsSync(file)) throw new Error(`Configuration does not exist: ${file}`);
    const supplied = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    // Resume keeps run settings, but current user policy replaces the recorded policy.
    const input = saved ? { ...saved, denylist: supplied.denylist ?? saved.denylist, ...overrides } : { ...supplied, ...overrides };
    const result = configSchema.parse(input);
    result.stateDir = resolve(result.stateDir.replace(/^~(?=\/|$)/, homedir()));
    return result;
  } catch (e) { throw new Stop('invalid_input', 'invalid_config', `Invalid configuration: ${e instanceof Error ? e.message : e}`); }
}
