---
name: code-generator
description: Delegate a precise coding implementation plan to the Code Generator CLI, monitor execution, resolve blockers, and review its evidence. Use when acting as the directing agent for a local implementation worker.
---

# Direct Code Generator

You own discovery, design decisions, plan authoring, blocker resolution, and final review. Code Generator owns repository inspection needed for implementation, edits, checks, and durable execution. Resolve ordinary implementation details through the worker; make decisions that change intent or scope yourself within the user's authorization. Do not delegate open-ended product discovery or ask the worker to invent requirements.

## Locate the executable and prepare a plan

Use the user's configured executable. From a source checkout, run `npm ci` and `npm run build`, then invoke `node /absolute/path/to/code-generator/dist/cli.js`. For a packaged installation, use `code-generator` or `npx --package /absolute/path/to/package.tgz code-generator`. Do not assume the package is on npm. Confirm `--version` and `--help` before relying on an unfamiliar installation.

Read `PLAN_TEMPLATE.md` in that source checkout or installed package. Preserve its required headings, field labels, stable S1/AC1 IDs, and explicit exit criteria; replace all placeholders. Every step must reference acceptance criteria. Define observable expected results as well as exact noninteractive verification commands. Include allowed changes, existing work to preserve, prerequisites, compatibility decisions, and delivery instructions. Default delivery to uncommitted changes for review unless the user authorized more.

Keep plan, configuration, logs, and central state outside the target when practical. Ensure `stateDir` is outside the target. Use absolute paths for plan, target, and config. Configure a reachable OpenAI-compatible endpoint and served model; the worker does not manage the inference server. For local inference, prefer a time bound and enough `maxOutputTokens` for reasoning and tool calls (default 16,384), rather than compressing a precise plan to fit a small output cap.

## Launch and monitor

In the examples, replace `code-generator` with the selected invocation and paths with actual absolute paths:

```sh
code-generator run /absolute/plan.md --target /absolute/repo --config /absolute/config.json --max-time 1h --output json
code-generator status RUN_ID --config /absolute/config.json --json
code-generator inspect RUN_ID --config /absolute/config.json --json
```

The run stays in the foreground. Use the harness's process/session facility to keep it running while you monitor; capture stdout, stderr, and exit status. JSON streaming output is newline-delimited events. Record the run ID from `run_start.payload.id` and retain the chosen config/state location. If execution ends before that event, inspect stderr and do not invent a run ID.

Default execution edits the target directly. Add `--worktree` for isolation only on a clean Git checkout with a commit. Record the resulting target path from status/inspect; review that directory, not the original checkout. Worktree cleanup and integration belong to you after reviewing the result.

`status` returns status, target, per-step progress, consumed budget, and reason. `inspect` includes full stored state, amendments, and actions. Both are read-only and their exit 0 means the query succeeded, not that implementation succeeded. Poll at useful intervals (for example 15–30 seconds), and inspect detailed logs when progress changes or stops. An interrupted harness stream is not proof that the worker stopped: check status and the process before resuming. Never run overlapping workers or a second resume on the same target.

Terminal streaming events and `<stateDir>/runs/<id>/report.json` contain status, reason, steps, budget, changes, pending actions, and artifact paths. `report.md` is a readable summary. Reports describe the latest completed attempt; use status for an active run. Full logs can be large: inspect referenced evidence selectively.

## Resolve stops and resume

Run/resume exit codes: 0 success, 2 invalid input, 3 blocker, 4 exhausted budget, 5 internal error, 6 locked, 130 interrupted by SIGINT, 143 by SIGTERM. Use the reason and evidence, not just the code, to choose a response.

- For a missing prerequisite, supply it within authorized scope and explain the new fact in resume instructions.
- For ambiguity, make the missing decision and state it explicitly. Preserve unaffected constraints and acceptance checks.
- For budget exhaustion, increase the total only within the user's allowed budget. Consumed time/tokens carry forward; `--max-time 2h` means two hours total, not two additional hours.
- For uncertain side effects, inspect the actual repository/process/artifacts before declaring an action applied or not applied. Never replay it blindly. The CLI accepts `Resolve action ACTION_ID as applied: EVIDENCE` or `Resolve action ACTION_ID as not-applied: EVIDENCE` in resume instructions.
- For an unexplained repeat failure, stop retrying and report the concrete blocker to the user. Do not weaken checks to obtain success.

```sh
code-generator resume RUN_ID --config /absolute/config.json --instructions 'The required contract file is now available. Read it and continue the original plan; preserve existing acceptance criteria.' --output json
```

Resume uses saved target, history, and budgets; do not pass `--target` or `--worktree`. Editing the original plan file does not amend a saved run. Explicit instructions create a recorded plan revision and can reset affected progress for fresh verification. Saved model/output settings are retained on resume; merely changing those fields in the config does not replace them. Model/base URL and budget CLI overrides are supported; a different output allowance currently requires a new run with updated config. Diagnose that limitation rather than repeatedly retrying an unchanged cap.

## Review delivery

Require terminal `succeeded`, completed steps, and final acceptance evidence. Inspect the diff and untracked files in the actual target; ordinary `git diff` excludes new files. Check scope, preserved tests, and whether the evidence establishes the requested behavior. Independently verify meaningful gaps such as installed-package behavior rather than duplicating every check.

Report the result, remaining limitations, run ID, review directory, and evidence locations. A successful worker run is implementation evidence, not automatic authorization to commit, publish, or merge. New work after success needs a new run. Keep central run artifacts when removing a reviewed worktree.
