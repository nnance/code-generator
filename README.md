# Code Generator

Draft a specification. Run the CLI. Review the implementation.

Code Generator is a non-interactive coding agent that turns a precise Markdown implementation plan into working code. It edits files, runs checks, and works autonomously until the plan's acceptance criteria pass or it encounters a blocker. Progress, evidence, and state are saved so you can inspect the result and resume with updated instructions.

Use it directly from your terminal, delegate work from another agent, or integrate it into scripts and automation. You decide what to build; Code Generator handles implementation.

Built with Node.js, TypeScript, and the **Vercel AI SDK** for model connectivity, streaming, tools, and the agent loop. It supports local models and hosted APIs through configurable OpenAI-compatible endpoints. The current CLI uses the SDK's OpenAI-compatible adapter; additional native SDK provider integrations are not yet exposed.

**Status: v1 is implemented and validated locally against rapid-mlx.** The package has not been published to npm. See [implementation progress](IMPLEMENTATION.md) for milestone and verification details.

## Ways to use it

- **From your terminal:** write a specification using the plan template, launch the CLI, and review the code and verification results. If it stops, provide clarification and resume.
- **With another agent:** let your preferred agent help discover requirements, draft plans, monitor implementation, and review changes using the companion skill.
- **In scripts and automation:** launch bounded jobs, consume JSON events and stable exit codes, and retain run IDs for monitoring and recovery.

The same plan-driven workflow supports each approach. Planning can happen in an editor, a conversation, or an automated system; execution uses a repeatable CLI interface.

## A precise implementation contract

The [planning template](PLAN_TEMPLATE.md) defines the agent's strict input contract: objective, scope, ordered steps, acceptance checks, and exit criteria. A free-form idea needs to be turned into that structure before execution. You can write the plan manually; having another agent author and check it is recommended for ensuring completeness and consistency.

The CLI validates plans before implementation and reports gaps or conflicts that need clarification. Passing validation does not replace the final acceptance checks. The long-term goal is to optimize execution around this contract for the selected model, using verified outcomes to improve reliability. Known validation and reporting limitations are tracked in the [backlog](BACKLOG.md).

## Agent integration

The [companion skill](skills/code-generator/SKILL.md) teaches a directing model to author plans, launch bounded runs, monitor JSON status, resolve blockers, resume, and review evidence. It ships in the npm tarball under `skills/code-generator/`. Load that file directly or copy the folder into your directing harness's skill directory. Keep access to the installed package's `PLAN_TEMPLATE.md`; the skill uses it as the authoritative plan format. No Codex-specific API or built-in orchestration service is required.

This companion skill is for the **directing model**. The worker separately discovers implementation skills only inside its target repository's `.agents/skills/`. Installing the companion skill does not expand the worker's skill roots or give it recursive delegation.

The CLI is the integration boundary: launch a process, retain the run ID, query `status`/`inspect`, and consume terminal reports. The calling person, agent, or workflow owns the specification and scope decisions; Code Generator handles routine implementation decisions. Successful execution produces reviewable changes, not automatic publication or merging.

## Local setup

Requires Node.js 22 or newer and access to a compatible local model server or hosted API. Configure `baseURL`, `model`, and `contextTokens` for your endpoint. The included local example defaults target `http://127.0.0.1:8001/v1`, model `qwen3.8-27b-4bit`, a 262,144-token context window, and one hour of active execution.

```sh
npm ci
npm run build
node dist/cli.js --help
node dist/cli.js run /path/to/implementation.md --target /path/to/repository
```

Use [config.example.json](config.example.json) as a starting point for user configuration, or pass it explicitly with `--config`. No API key is required for the local default. For authenticated providers, set `apiKeyEnv` to the name of an environment variable containing the key.

To test the distributable locally:

```sh
npm pack
npx --package ./nicknance-code-generator-0.1.0.tgz code-generator --help
```

## How it works

1. Write a plan using the [implementation plan template](PLAN_TEMPLATE.md), defining the objective, scope, ordered steps, acceptance checks, and exit criteria.
2. Run the agent in an existing local directory, or provide a target path. It validates the plan and model capabilities before modifying the target.
3. The agent implements each step, runs checks, repairs routine errors, and records evidence. Every acceptance criterion is checked again against the final state before success.
4. If it encounters ambiguity, an unresolved blocker, a budget limit, or an interruption, it saves state and explains why it stopped.
5. Inspect the result and resume with additional CLI instructions when needed.

The agent never pauses to ask questions. Routine compilation errors and failing tests are repairable within the plan; decisions outside the specification cause an explained stop.

## Capabilities

- **Coding tools:** file reading, listing, path search, grep, edits, shell execution, and plan tracking.
- **Process management:** command timeouts, tracked background processes, and captured stdout/stderr.
- **Repository guidance:** scoped `AGENTS.md` instructions and skills discovered only under `.agents/skills/**/SKILL.md`. Skill descriptions load first; full instructions load when needed.
- **Resumable execution:** durable checkpoints, full received model/tool output, and recorded completion evidence. Interrupted actions are inspected before continuing; uncertain side effects cause a stop.
- **Bounded work:** cumulative active-time and/or token budgets, preserved across resumes.
- **Model context:** prompt caching through stable request prefixes and supported provider behavior, plus context compaction while retaining full history on disk.
- **Observable runs:** readable streaming output, newline-delimited JSON events, and final reports with results and resume guidance.

## CLI

After building, invoke the CLI with `node dist/cli.js`. The packaged executable is named `code-generator`; the examples below use that name.

```sh
# Execute a plan in the current directory
code-generator run ./implementation.md --max-time 1h

# Select an existing target directory and create an isolated Git worktree
code-generator run ./implementation.md --target /path/to/repository --worktree --max-time 1h

# Inspect progress and recorded results
code-generator status <run-id> --json
code-generator inspect <run-id>

# Resume with amended instructions
code-generator resume <run-id> --instructions 'Use the existing parser; do not add a dependency.'

# Increase the total time allowance for an exhausted run
code-generator resume <run-id> --max-time 2h

# Stream machine-readable events
code-generator run ./implementation.md --output json --max-time 1h
```

`status` and `inspect` are read-only and do not call the model. Editing the original plan file does not change a stored run; use `resume --instructions` to record amendments. Completed runs remain available for inspection; new work starts a new run.

## Configuration and budgets

User configuration lives at `~/.code-generator/config.json`, with `--config` for an alternative file and CLI options overriding configured values. It covers the endpoint, model ID, credential environment variable, context capacity, budgets, timeouts, command denylist, state directory, and output mode.

Every run requires at least one finite positive time or token limit. Configured defaults are allowed; there is no unlimited fallback. If both limits are set, reaching either stops execution.

- Time counts active execution, including inference, tools, retries, and verification. Time spent stopped is excluded.
- Tokens count input and output across model calls, including compaction and cached input tokens.
- Resume retains consumption. `--max-time 2h` sets the total allowance to two hours; it does not add two hours. An exhausted run requires an explicit increase.

The default `maxOutputTokens` is 16,384 per response, including plan assessment, to leave room for local model reasoning and tool calls. Raise it in configuration for models that need longer responses; this is a ceiling, not a requirement to generate that many tokens.

**Token reservation:** token-limited requests currently reserve the server-advertised full context plus an output allowance, then reconcile to actual usage. For example, a server advertising a 262,144-token context requires more than 278,528 remaining tokens with the default 16,384-token output allowance. A smaller remaining allowance can stop the run before a request even when the eventual prompt would be shorter. Time-only operation avoids this conservative reservation requirement.

Run history and full output is stored centrally under `~/.code-generator/runs/<run-id>/`, with owner-only permissions. Application-generated logs exclude credentials, although captured command output may contain secrets printed by those commands.

## Working directory and command policy

The default is to work directly in the target directory while preserving unrelated existing edits. Optional worktree mode creates a separate branch and worktree from HEAD, requires a clean source checkout, and retains the worktree for inspection. Commits and pushes occur only when explicitly requested by the plan or resume instructions.

Separate invocations may work in distinct directories concurrently. Exclusive locks prevent overlapping runs against the same working directory.

Shell access allows dependency installation, Git operations, and network requests. A user-configured denylist blocks accidental destructive commands such as `rm -rf *`. It is an accident-prevention measure, not a security sandbox; repository instructions cannot weaken it.

## Runtime and development

The implementation uses **Node.js and TypeScript**, with the **Vercel AI SDK** providing model connectivity, streaming, tools, and the agent loop. Prefer Node built-ins and add external dependencies only when they provide substantial value.

The configured model/server must support streaming and native tool calling, plus usable token accounting for token-limited runs. Compatibility is checked before target modifications. The same model handles execution and context compaction; no implicit cloud fallback is planned.

**All end-to-end tests must use a live rapid-mlx server.** Mocks, prerecorded model responses, and substituted hosted models do not qualify. An unavailable server fails the E2E prerequisite check rather than silently skipping tests. Unit and component tests may use test doubles for deterministic behavior.

Run verification with:

```sh
npm test
npm run test:e2e
```

E2E tests use the local defaults. Set `RAPID_MLX_URL` and `RAPID_MLX_MODEL` to select another live rapid-mlx instance. They create disposable repositories and retain diagnostic artifacts; `.test-artifacts/` contains references to results.

## Recovery

`status` identifies stale runs after an unexpected process exit. `resume` reconciles pending writes and supervised commands before continuing. Full output and both JSON and Markdown terminal reports live in the run directory.

If an action's outcome cannot be determined, inspect its output and supply an explicit resolution with supporting evidence:

```sh
code-generator resume <run-id> --instructions 'Resolve action <action-id> as applied: verified the remote commit exists.'
```

Use `as not-applied:` when inspection establishes that it did not take effect. Ordinary resume instructions can amend the plan; original plan text remains immutable and new revisions invalidate prior step evidence.

## V1 boundaries

Version one uses a single agent executing one plan sequentially. It operates on existing local directories and does not include subagents, repository cloning, project bootstrapping, inference-server management, a UI, or a built-in monitor. Dedicated web search and page-fetch tools are also outside v1.

## Documentation

- [Product specification](PRODUCT_SPEC.md): full requirements, recovery semantics, exit codes, and release acceptance criteria.
- [Implementation plan template](PLAN_TEMPLATE.md): required structure for plans submitted to the agent.
