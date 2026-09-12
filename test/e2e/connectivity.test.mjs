import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../../dist/config.js';
import { probe } from '../../dist/model.js';

test('live rapid-mlx streams native tool calling and usage', { timeout: 180000 }, async () => {
  const config = loadConfig(undefined, {
    baseURL: process.env.RAPID_MLX_URL ?? 'http://127.0.0.1:8001/v1',
    model: process.env.RAPID_MLX_MODEL ?? 'qwen3.8-27b-4bit',
  });
  const result = await probe(config);
  const metrics = await (await fetch(new URL('/metrics', config.baseURL))).text();
  assert.match(metrics, /rapid_mlx_build_info/);
  assert.ok(result.usage.inputTokens > 0);
  assert.ok(result.usage.outputTokens > 0);
  assert.ok(result.usage.inputTokenDetails.cacheReadTokens > 0, 'Live tool-result round trip must show prefix-cache reuse');
  mkdirSync('.test-artifacts', { recursive: true });
  writeFileSync('.test-artifacts/connectivity.json', JSON.stringify({ date: new Date(), server: metrics.split('\n').find(l => l.startsWith('rapid_mlx_build_info')), ...result }, null, 2));
});
