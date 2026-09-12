import { openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './state.js';
import { Budget } from './budget.js';
import { hash } from './plan.js';
import { Stop } from './errors.js';

export function transport(store: Store, budget: Budget): typeof fetch {
  let inputBound: number | undefined;
  return async (url, options) => {
    budget.check();
    const address = String(url); const c = store.state.config;
    const signal = AbortSignal.any([budget.controller.signal, AbortSignal.timeout(c.apiTimeoutMs), ...(options?.signal ? [options.signal] : [])]);
    if (!address.endsWith('/chat/completions')) {
      const response = await fetch(url, { ...options, signal });
      if (address.endsWith('/models') && response.ok) {
        const data = await response.clone().json() as { data?: { id: string; context_window?: number; max_model_len?: number }[] };
        const entry = data.data?.find(m => m.id === c.model); inputBound = entry?.max_model_len ?? entry?.context_window;
        store.event('model_capabilities', { model: c.model, context: inputBound });
      }
      return response;
    }
    if (c.maxTokens !== null && (!inputBound || !Number.isFinite(inputBound))) throw new Stop('blocked', 'token_accounting_unavailable', 'Token-limited runs require a server-advertised context bound; configure a time-only run for this provider.');
    const body = JSON.parse(String(options?.body));
    for (let attempt = 0; ; attempt++) {
      budget.check();
      // The advertised entire context is a conservative reservation. Actual usage
      // replaces it on completion; no character/token guess enforces a hard limit.
      const reservation = budget.reserve(inputBound ?? c.contextTokens, body.max_tokens ?? body.max_completion_tokens ?? c.maxOutputTokens);
      if ('max_completion_tokens' in body) body.max_completion_tokens = reservation.output; else body.max_tokens = reservation.output;
      body.parallel_tool_calls = false;
      const fingerprint = hash(JSON.stringify({ model: body.model, messages: body.messages?.slice(0, 1), tools: body.tools }));
      const requestArtifact = store.artifact('model-request', body);
      store.event('model_request', { requestArtifact, fingerprint, attempt, reservation: reservation.id });
      let response: Response;
      try { response = await fetch(url, { ...options, body: JSON.stringify(body), signal }); }
      catch (e) {
        budget.settle(reservation.id);
        if (signal.aborted || attempt >= c.retries) throw e;
        store.event('retry', { attempt: attempt + 1, reason: 'network_error' });
        await new Promise(r => setTimeout(r, 250 * 2 ** attempt)); continue;
      }
      if (!response.ok) {
        const text = await response.text(); store.artifact('model-error', { status: response.status, text });
        // A rejected request has no observed generation, but retain the reservation
        // conservatively for server errors whose inference outcome is unknown.
        budget.settle(reservation.id, response.status < 500 ? 0 : undefined, response.status < 500 ? 0 : undefined);
        if ((response.status === 429 || response.status >= 500) && attempt < c.retries) { await new Promise(r => setTimeout(r, 250 * 2 ** attempt)); continue; }
        throw new Stop('blocked', 'provider_error', `Model request failed: HTTP ${response.status}. ${text.slice(0, 1000)}`);
      }
      const outputPath = join(store.dir, 'artifacts', `model-stream-${randomUUID()}.sse`);
      const fd = openSync(outputPath, 'wx', 0o600); let closed = false;
      const close = () => { if (!closed) { fsyncSync(fd); closeSync(fd); closed = true; } };
      let pending = ''; const decoder = new TextDecoder();
      let usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
      const reader = response.body?.getReader();
      if (!reader) { close(); budget.settle(reservation.id); throw new Stop('blocked', 'empty_response', 'Provider returned no stream'); }
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { value, done } = await reader.read();
            if (done) {
              close(); budget.settle(reservation.id, usage?.prompt_tokens, usage?.completion_tokens);
              store.event('model_usage', { usage: usage ?? null, outputPath, fingerprint }); controller.close(); return;
            }
            writeFileSync(fd, value); fsyncSync(fd);
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n'); pending = lines.pop()!;
            for (const line of lines) if (line.startsWith('data: ') && line.slice(6).trim() !== '[DONE]') {
              try { const event = JSON.parse(line.slice(6)); if (event.usage) usage = event.usage; } catch { /* SDK validates malformed protocol */ }
            }
            controller.enqueue(value);
          } catch (e) { close(); budget.settle(reservation.id); controller.error(e); }
        },
        async cancel(reason) { close(); budget.settle(reservation.id, usage?.prompt_tokens, usage?.completion_tokens); await reader.cancel(reason); },
      });
      return new Response(stream, { status: response.status, headers: response.headers });
    }
  };
}
