# Code Generator

A non-interactive CLI coding agent that takes a precise Markdown implementation plan and works autonomously until its acceptance criteria pass or an explicit stopping condition occurs. It records evidence, streams progress, and saves state so a person or automated process can inspect and resume the work.

Designed for real coding tasks on a dedicated Mac Studio M3 Ultra using local open-weight models served by rapid-mlx. Other model servers can be configured if they support the required OpenAI-compatible API capabilities.

**Status: v1 is implemented and validated locally against rapid-mlx.** The package has not been published to npm. See [implementation progress](IMPLEMENTATION.md) for milestone and verification details.

## Local setup

Requires Node.js 22 or newer and an already-running model server. The defaults target `http://127.0.0.1:8001/v1`, model `qwen3.8-27b-4bit`, a 262,144-token context window, and one hour of active execution.

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

**Token reservation:** token-limited requests currently reserve the server-advertised full context plus an output allowance, then reconcile to actual usage. With this model, allow more than 278,528 remaining tokens for the default 16,384-token output allowance. A smaller remaining allowance can stop the run before a request even when the eventual prompt would be shorter. Time-only operation avoids this conservative reservation requirement.

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
