# Code Generator

A non-interactive CLI coding agent that takes a precise Markdown implementation plan and works autonomously until its acceptance criteria pass or an explicit stopping condition occurs. It records evidence, streams progress, and saves state so a person or automated process can inspect and resume the work.

Designed for real coding tasks on a dedicated Mac Studio M3 Ultra using local open-weight models served by rapid-mlx. Other model servers can be configured if they support the required OpenAI-compatible API capabilities.

**Status: specification complete; implementation has not started.** The features and commands below describe the planned v1 interface. Distribution through `npx` is planned; the npm package identity is not yet finalized.

## How it works

1. Write a plan using the [implementation plan template](PLAN_TEMPLATE.md), defining the objective, scope, ordered steps, acceptance checks, and exit criteria.
2. Run the agent in an existing local directory, or provide a target path. It validates the plan and model capabilities before modifying the target.
3. The agent implements each step, runs checks, repairs routine errors, and records evidence. Every acceptance criterion is checked again against the final state before success.
4. If it encounters ambiguity, an unresolved blocker, a budget limit, or an interruption, it saves state and explains why it stopped.
5. Inspect the result and resume with additional CLI instructions when needed.

The agent never pauses to ask questions. Routine compilation errors and failing tests are repairable within the plan; decisions outside the specification cause an explained stop.

## Planned capabilities

- **Coding tools:** file reading, listing, path search, grep, edits, shell execution, and plan tracking.
- **Process management:** command timeouts, tracked background processes, and captured stdout/stderr.
- **Repository guidance:** scoped `AGENTS.md` instructions and skills discovered only under `.agents/skills/**/SKILL.md`. Skill descriptions load first; full instructions load when needed.
- **Resumable execution:** durable checkpoints, full received model/tool output, and recorded completion evidence. Interrupted actions are inspected before continuing; uncertain side effects cause a stop.
- **Bounded work:** cumulative active-time and/or token budgets, preserved across resumes.
- **Model context:** prompt caching through stable request prefixes and supported provider behavior, plus context compaction while retaining full history on disk.
- **Observable runs:** readable streaming output, newline-delimited JSON events, and final reports with results and resume guidance.

## Planned CLI

These examples describe the intended executable; they are not installation or execution instructions for a released package.

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

User configuration will live at `~/.code-generator/config.json`, with `--config` for an alternative file and CLI options overriding configured values. It will cover the endpoint, model ID, credential environment variable, context capacity, budgets, timeouts, command denylist, state directory, and output mode.

Every run requires at least one finite positive time or token limit. Configured defaults are allowed; there is no unlimited fallback. If both limits are set, reaching either stops execution.

- Time counts active execution, including inference, tools, retries, and verification. Time spent stopped is excluded.
- Tokens count input and output across model calls, including compaction and cached input tokens.
- Resume retains consumption. `--max-time 2h` sets the total allowance to two hours; it does not add two hours. An exhausted run requires an explicit increase.

Run history and full output will be stored centrally under `~/.code-generator/runs/<run-id>/`, with owner-only permissions. Application-generated logs exclude credentials, although captured command output may contain secrets printed by those commands.

## Working directory and command policy

The default is to work directly in the target directory while preserving unrelated existing edits. Optional worktree mode creates a separate branch and worktree from HEAD, requires a clean source checkout, and retains the worktree for inspection. Commits and pushes occur only when explicitly requested by the plan or resume instructions.

Separate invocations may work in distinct directories concurrently. Exclusive locks prevent overlapping runs against the same working directory.

Shell access allows dependency installation, Git operations, and network requests. A user-configured denylist blocks accidental destructive commands such as `rm -rf *`. It is an accident-prevention measure, not a security sandbox; repository instructions cannot weaken it.

## Runtime and development

The implementation will use **Node.js and TypeScript**, with the **Vercel AI SDK** providing model connectivity, streaming, tools, and the agent loop. Prefer Node built-ins and add external dependencies only when they provide substantial value.

The configured model/server must support streaming and native tool calling, plus usable token accounting for token-limited runs. Compatibility is checked before target modifications. The same model handles execution and context compaction; no implicit cloud fallback is planned.

**All end-to-end tests must use a live rapid-mlx server.** Mocks, prerecorded model responses, and substituted hosted models do not qualify. An unavailable server fails the E2E prerequisite check rather than silently skipping tests. Unit and component tests may use test doubles for deterministic behavior.

## V1 boundaries

Version one uses a single agent executing one plan sequentially. It operates on existing local directories and does not include subagents, repository cloning, project bootstrapping, inference-server management, a UI, or a built-in monitor. Dedicated web search and page-fetch tools are also outside v1.

## Documentation

- [Product specification](PRODUCT_SPEC.md): full requirements, recovery semantics, exit codes, and release acceptance criteria.
- [Implementation plan template](PLAN_TEMPLATE.md): required structure for plans submitted to the agent.
