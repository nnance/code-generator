import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';
import type { Store } from './state.js';
import type { Budget } from './budget.js';
import { model } from './model.js';
import { Stop } from './errors.js';

export async function assess(store: Store, budget: Budget, fetcher: typeof fetch) {
  let decision: { executable: boolean; explanation: string } | undefined;
  const agent = new ToolLoopAgent({ model: model(store.state.config, fetcher), maxRetries: 0, providerOptions: store.state.config.providerOptions, maxOutputTokens: store.state.config.maxOutputTokens,
    instructions: 'Review this plan for material ambiguity before any repository changes. The objective, scope, steps, and checks must agree. An explicitly unresolved behavioral choice or conflicting requirements MUST produce executable=false, even if a later step suggests one possible implementation. Ordinary coding details, discoverable project facts, and routine errors can be resolved during execution. Do not invent new requirements. Submit your assessment through assess_plan.',
    tools: { assess_plan: tool({ inputSchema: z.object({ executable: z.boolean(), explanation: z.string().min(1) }), execute: async value => { decision = value; return { recorded: true }; } }) },
    toolChoice: { type: 'tool', toolName: 'assess_plan' }, stopWhen: () => true,
  });
  const result = await agent.stream({ prompt: store.state.plan.source, abortSignal: budget.controller.signal });
  for await (const part of result.fullStream) if (part.type === 'error') throw part.error;
  const value = decision as { executable: boolean; explanation: string } | undefined;
  if (!value && await result.finishReason === 'length') {
    const explanation = `Plan assessment reached its output token limit (configured maxOutputTokens: ${store.state.config.maxOutputTokens}). Increase maxOutputTokens and ensure any total token budget has room for the response.`;
    store.event('plan_assessment', { executable: false, explanation, reason: 'assessment_output_limit' });
    throw new Stop('blocked', 'assessment_output_limit', explanation);
  }
  store.event('plan_assessment', value ?? { executable: false, explanation: 'No valid assessment returned' });
  if (!value?.executable) throw new Stop('blocked', 'ambiguous_plan', value?.explanation ?? 'Model could not establish that the plan is executable.');
}
