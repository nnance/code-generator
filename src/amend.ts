import { ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';
import { Store } from './state.js';
import { Budget } from './budget.js';
import { model } from './model.js';
import { parsePlan, type Plan } from './plan.js';
import { Stop } from './errors.js';

export function resolveActions(store: Store, text: string) {
  for (const m of text.matchAll(/Resolve action ([a-f\d-]{36}) as (applied|not-applied):\s*([^\n]+)/gi)) {
    const action = store.state.actions[m[1]];
    if (!action || action.status !== 'pending') throw new Stop('invalid_input', 'invalid_resolution', `Action ${m[1]} is not pending.`);
    if (m[2].toLowerCase() === 'applied') store.complete(action, { userResolved: true, evidence: m[3] });
    else store.fail(action, `User confirmed not applied: ${m[3]}`);
    store.event('action_resolution', { id: action.id, outcome: m[2], evidence: m[3] });
  }
}
export async function amend(store: Store, budget: Budget, fetcher: typeof fetch, text: string) {
  let updated: Plan | undefined;
  const previous = store.state.plan;
  const agent = new ToolLoopAgent({ model: model(store.state.config, fetcher), maxRetries: 0, providerOptions: store.state.config.providerOptions, maxOutputTokens: store.state.config.maxOutputTokens,
    instructions: 'Apply only the explicit user amendment to the existing Markdown implementation plan. Keep required headings/labels and stable IDs. Preserve all unaffected requirements. Never weaken acceptance criteria without an explicit request about those checks. Return the complete revised plan through save_plan. If the amendment only resolves an action or says to continue, preserve the plan exactly.',
    tools: { save_plan: tool({ inputSchema: z.object({ markdown: z.string() }), execute: async i => {
      const plan = parsePlan(i.markdown);
      const changedCriteria = JSON.stringify(plan.criteria) !== JSON.stringify(previous.criteria) || plan.exit !== previous.exit;
      if (changedCriteria && !/\b(?:acceptance|criteria|criterion|AC\d+|exit|checks?|tests?|verif\w*)\b/i.test(text)) throw new Error('The user did not explicitly authorize changing acceptance checks. Preserve them exactly.');
      updated = plan; return { accepted: true };
    } }) }, stopWhen: ({ steps }) => !!updated || steps.length >= 4,
  });
  const result = await agent.stream({ prompt: JSON.stringify({ plan: previous.source, amendment: text }), abortSignal: budget.controller.signal });
  for await (const part of result.fullStream) if (part.type === 'error') throw part.error;
  if (!updated) throw new Stop('blocked', 'amendment_unresolved', 'Could not apply the amendment without ambiguity. Clarify the requested change.');
  store.state.plan = updated; store.state.revision++;
  store.state.steps = Object.fromEntries((updated as Plan).steps.map(s => [s.id, { status: 'pending' }]));
  store.event('plan_revision', { revision: store.state.revision, plan: updated, cacheInvalidated: true }); store.save();
}
