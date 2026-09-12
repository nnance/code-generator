import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { z } from 'zod';
import type { Config } from './config.js';
import { Stop } from './errors.js';

export function model(config: Config, fetcher?: typeof fetch) {
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  if (config.apiKeyEnv && !apiKey) throw new Stop('blocked', 'missing_credential', `Missing environment variable ${config.apiKeyEnv}`);
  return createOpenAICompatible({ name: 'compatible', baseURL: config.baseURL, apiKey: apiKey ?? 'local', includeUsage: true, fetch: fetcher }).chatModel(config.model);
}
export async function probe(config: Config, fetcher?: typeof fetch, signal?: AbortSignal) {
  const client = fetcher ?? fetch;
  const response = await client(`${config.baseURL.replace(/\/$/, '')}/models`, { signal: signal ?? AbortSignal.timeout(config.apiTimeoutMs), headers: config.apiKeyEnv ? { Authorization: `Bearer ${process.env[config.apiKeyEnv] ?? ''}` } : {} });
  if (!response.ok) throw new Stop('blocked', 'model_unavailable', `Model listing returned HTTP ${response.status}`);
  const listing = await response.json() as { data?: { id: string; context_window?: number }[] };
  const found = listing.data?.find(m => m.id === config.model);
  if (!found) throw new Stop('blocked', 'model_unavailable', `Model ${config.model} is not listed by ${config.baseURL}`);
  if (found.context_window && config.contextTokens > found.context_window) throw new Stop('invalid_input', 'context_exceeds_model', `Configured context ${config.contextTokens} exceeds model capacity ${found.context_window}. Set contextTokens in configuration.`);
  let called = false;
  const agent = new ToolLoopAgent({
    model: model(config, fetcher), maxOutputTokens: 128, maxRetries: 0, providerOptions: config.providerOptions,
    instructions: 'Call connectivity_check with value ready, then reply READY after its result. This is a harmless connectivity test.',
    tools: { connectivity_check: tool({ inputSchema: z.object({ value: z.literal('ready') }), execute: async () => { called = true; return { status: 'ready' }; } }) },
    stopWhen: isStepCount(2),
  });
  const result = await agent.stream({ prompt: 'Perform the connectivity check now.', abortSignal: signal ?? AbortSignal.timeout(config.apiTimeoutMs) });
  const chunks = [];
  for await (const chunk of result.fullStream) { if (chunk.type === 'error') throw chunk.error; chunks.push(chunk); }
  if (!called || !(await result.text).includes('READY')) throw new Stop('blocked', 'incompatible_model', 'Model failed the streaming tool-call/result round trip.');
  return { model: found, usage: await result.totalUsage, chunks };
}
