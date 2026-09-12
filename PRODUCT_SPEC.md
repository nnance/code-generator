# Code Generator — Product Specification

Status: v1 product baseline. The local CLI is implemented; see [IMPLEMENTATION.md](IMPLEMENTATION.md) for milestone and validation results.

## 1. Purpose and user

Code Generator is a non-interactive CLI coding agent. It accepts a precise implementation plan in Markdown, operates autonomously in an existing local directory, and stops only when the plan's completion requirements are satisfied or an explicit stopping condition occurs. It reports evidence of its work and maintains durable state so a person or automated monitor can inspect and resume it with updated instructions.

The first user is the project owner, running real coding tasks on a dedicated or mostly dedicated Mac Studio M3 Ultra. The primary inference backend is a live rapid-mlx server serving a local open-weight model. Other servers exposing the required OpenAI-compatible API capabilities are supported through configuration.

Implementation: Node.js and TypeScript, runnable through `npx`. Use the Vercel AI SDK for model connectivity, streaming, tools, and its agent loop. Prefer Node built-ins; add dependencies only where they provide substantial value. The implementation repository is `genai/code-generator`.

## 2. Scope

### Included in v1

- One agent executing one plan sequentially, without prompts for human input.
- Current-directory and explicit target-directory execution; optional Git worktree.
- Required Markdown plan template with stable step and criterion IDs.
- File reading, listing, searching, grep, editing, shell execution, and plan tracking.
- Command timeouts, background process tracking, and output capture.
- Repository-local skills under `.agents/skills/` only and scoped `AGENTS.md` instructions.
- Durable histories, checkpoints, recovery, and CLI instruction amendments.
- Cumulative active-time and/or token limits across resumes.
- Configurable command denylist for accident prevention.
- Prompt caching support and context compaction.
- Human-readable streaming output and machine-readable JSON events.
- Concurrent invocations for distinct working directories with exclusive directory locks.

### Excluded from v1

- Subagents, task delegation, or parallel plan execution within one run.
- Interactive clarification or approval dialogs, a UI, daemon, or built-in monitor.
- Repository cloning, new project bootstrapping, and inference-server management.
- Dedicated web search or page-fetch tools; shell network access remains available.
- Global skills, `.codex/skills`, extra skill discovery roots, and instruction filenames other than `AGENTS.md`.
- A security sandbox or comprehensive prevention of malicious command execution.
- Automatic commits, pushes, merges, or publishing merely because implementation succeeds.

## 3. CLI contract

The examples below specify the intended command surface. `code-generator` is the working executable name; npm package availability and publishing identity must be checked before distribution.

```sh
code-generator run ./implementation.md
code-generator run ./implementation.md --target /path/to/repository --max-time 1h
code-generator run ./implementation.md --target /path/to/repository --worktree
code-generator resume <run-id> --instructions 'Use the existing parser; do not add a dependency.'
code-generator resume <run-id> --max-time 2h --max-tokens 500000
code-generator status <run-id> --json
code-generator inspect <run-id>
code-generator run ./implementation.md --output json
```

| Command | Behavior |
| --- | --- |
| `run <plan>` | Validate the plan/configuration, establish state and lock, check model compatibility, then execute. Target defaults to the invocation directory. |
| `resume <run-id>` | Recover the existing run, retain consumed budgets and original plan, append optional `--instructions`, reconcile interrupted work, then continue. |
| `status [run-id]` | Read-only current state and budget summary; without an ID, list known runs. No model request. |
| `inspect <run-id>` | Read-only detailed steps, criteria, amendments, stop explanation, and references to full stored output. No model request. |

Common options include `--config`, `--output human|json`, model/base-URL overrides, `--max-time`, and `--max-tokens`. `--target` and `--worktree` apply to new runs; resume uses the recorded working directory. Relative plan and target paths resolve against the invocation directory. Help must document units, defaults, exit codes, and example resume commands. No command waits for stdin or approval.

Successful runs cannot resume as unfinished work. A new task after success starts a new run.

## 4. Configuration

Use a versioned JSON configuration at `~/.code-generator/config.json`, with `--config` selecting an alternative. Resolution order is explicit CLI options, selected user configuration, then documented application defaults. There is no repository configuration that changes runtime policy.

Configuration covers:

- Provider base URL, explicit model ID, optional API-key environment variable name, and supported provider-specific request options.
- Maximum active execution time and/or maximum total tokens. At least one finite positive limit is required; no unlimited fallback.
- Model context capacity, generation output cap, and compaction threshold.
- Command timeout, API timeout, bounded retry settings, and process shutdown grace period.
- Command denylist rules with IDs, patterns, and explanations.
- Central state directory and output mode.

Store resolved non-secret configuration with each run. Resolve credentials from the environment; do not persist credential values or authorization headers. For an unauthenticated local server, allow the adapter to supply a non-secret placeholder if required.

A resume retains the recorded effective settings and budget totals unless explicitly overridden. Re-read the user command policy on resume; repository files and model calls cannot disable it. Log configuration and policy revisions. A model or endpoint change on resume requires a compatibility check and context/caching reassessment.

Recommended initial operational defaults, adjustable during implementation validation: shell timeout 120 seconds, API timeout 300 seconds, two transient retries with bounded backoff, five-second process shutdown grace, and compaction near 80% of configured context capacity. Time/token run budgets and model context capacity require configuration rather than guessed universal values.

## 5. Plan input and completion contract

Use [PLAN_TEMPLATE.md](PLAN_TEMPLATE.md). Version one has a constrained Markdown structure, enabling deterministic structural validation without depending on an LLM to discover sections.

Required fields and sections:

- Format version and a concrete title.
- Objective: externally observable intended result.
- Scope and constraints: allowed work, explicit exclusions, environment assumptions, and any delivery actions such as commits or pushes.
- Ordered steps: unique stable IDs, actions, and references to acceptance criteria.
- Acceptance criteria: unique stable IDs, verification kind, procedure or command, expected result, and evidence to record.
- Exit criteria: all steps complete, all acceptance criteria verified against the final state, and no unresolved blockers.

Every step references at least one criterion. Every criterion defines a runnable command or a concrete agent-observable verification procedure. A criterion requiring a human decision is a blocker in this non-interactive product unless explicit resume instructions resolve it. Unresolved placeholders, missing fields, duplicate IDs, and dangling criterion references are input errors before repository modification. Semantic ambiguity discovered later causes a blocked stop.

The original plan is copied and hashed at run creation. Subsequent edits to the source Markdown do not silently change the run. Resume text becomes a timestamped, durable amendment; it may explicitly change scope, steps, or acceptance criteria. Maintain an effective plan revision and invalidate affected prior evidence. Never silently loosen criteria to make tests pass.

Step states are `pending`, `in_progress`, `completed`, and `blocked`. Completion evidence includes relevant paths, tool/action IDs, verification results, and a brief explanation linking the work to the criterion. Editing a file is not by itself proof of completion.

The model may propose completion, but the controller owns the final success gate. Re-run every acceptance command and re-evaluate every observable criterion at the end. Record command, working directory, exit status, output references, and repository/content state. A command exiting zero is insufficient when additional expected-output assertions are specified. Subsequent changes affecting evidence invalidate it. No success exit until the gate passes.

## 6. Agent execution and stopping

Use the AI SDK's agent loop for model/tool iterations, surrounded by a small application controller for budgets, state, policy, and completion. Do not build a second independent LLM orchestration framework.

Execution sequence:

1. Validate CLI/configuration and plan, canonicalize paths, and establish the central run record and lock.
2. Record the initial directory/Git state. Check the endpoint/model with a harmless streaming native-tool-call probe before target modifications, including worktree creation.
3. Establish the effective working directory, load applicable root instructions, and discover skill metadata.
4. Execute the ordered plan. Read scoped instructions before operating in their scope. Persist model output and each proposed tool action before performing its side effect.
5. Capture tool results, update evidence and progress, evaluate stopping conditions, and compact context as needed.
6. Run the final completion gate or record a precise non-success reason.
7. Stop managed processes, persist the terminal report, release the lock, and exit.

Routine compile errors, failing tests, tool mistakes, and implementation defects are repairable within the plan. Missing credentials, unavailable prerequisites after bounded retries, contradictory requirements, material ambiguity, uncertain prior side effects, and decisions outside the plan's scope cause a blocked stop.

Prevent unproductive repetition: stop with evidence after three materially identical failures with no intervening progress by default. Make this threshold configurable. A model ending its response or the SDK reaching a step boundary does not imply task completion; the controller must continue eligible work or record an explicit stop reason.

No runtime questions. A stop report states what failed, what was attempted, what remains, and what instructions or external change would permit resumption.

## 7. Tools and command policy

| Tool capability | Required behavior |
| --- | --- |
| Read | Read file ranges with line numbers; identify binary/oversized content and retain output references. |
| List/search paths | Directory listing and glob-style path discovery, with deterministic ordering. |
| Grep | Literal or regex content search with path filters, line numbers, and bounded model-visible results. Prefer `rg` when present; provide a documented fallback without requiring a separate install. |
| Edit | Create/modify files through explicit writes or patches, check expected prior content to detect conflicts, and record before/after hashes. |
| Shell | Run non-interactively in an explicit working directory, capture stdout/stderr, exit status, timing, and process identity. |
| Process management | Start, inspect, poll, and stop tracked background processes. |
| Plan tracking | Update step state, attach evidence, request a blocker stop, or submit completion for controller validation. |
| Skill loading | Load a discovered skill's full instructions and repository-local supporting files on demand. |

Model-visible output may be paginated or truncated with a clear marker and artifact reference. Full received output stays in central storage. Tool schemas must be explicit and validated before execution. Execute mutating calls serially even when a model emits multiple calls in one response.

Shell access can install dependencies, invoke Git, run checks, and access the network. File tools default to the target directory; the shell is not sandboxed. All agent-issued shell actions, including skill scripts and acceptance commands, pass through the same denylist.

The denylist is an accident-prevention layer: inspect command text before execution using documented matching rules, including common whitespace/flag variants for bundled dangerous patterns. Include rules catching wildcard recursive deletion such as `rm -rf *`, root/home recursive deletion, and destructive Git resets/cleans by default. Unit-test matching and benign counterexamples. Reject malformed rules at startup. A match causes a blocked stop that identifies the rule and command; do not seek an equivalent workaround.

Arbitrary shell syntax, scripts, and indirect execution can evade a command denylist. This is an accepted v1 limitation, not a security guarantee. Only user-level configuration or CLI policy settings may change rules, never instructions in the repository or a model tool call.

## 8. Working directories and Git

- Default: modify the existing target directly. Git is not required unless worktree mode or plan commands require it.
- Record HEAD, branch, status, and the initial diff/untracked-file inventory when Git exists. Preserve unrelated pre-existing changes; stop when overlap cannot be resolved within the specification.
- `--worktree`: require Git and create a unique run branch/worktree from the current HEAD. Retain it for inspection after stopping or success. Do not merge it back or delete it automatically.
- A dirty source checkout in worktree mode causes a preflight error in v1, with an explanation that uncommitted work is not included. The user can select direct mode or prepare a clean checkout. This avoids silently discarding expected context.
- Record both source and effective worktree paths. Skills and scoped instructions are read from the effective working directory.
- Commit or push only when explicitly requested by the plan or resume instructions. Record related commit IDs and remote results as evidence. Never commit unrelated initial changes.
- Acquire an exclusive lock for the canonical working directory and prevent overlapping ancestor/descendant target runs. Different isolated worktrees can run independently; serialize shared Git administrative operations where necessary.
- A stale lock may be recovered only after checking process identity and reconciling interrupted actions. Do not remove a lock merely because it is old.

## 9. Skills and repository instructions

Discover skills exclusively at `<effective-target>/.agents/skills/**/SKILL.md`. Do not search the user's home, ancestor repositories, `.codex/skills`, or other configured directories. Reject symlink escapes from this discovery root.

Each skill has frontmatter containing `name` and `description`, followed by instructions. Supporting scripts and references resolve relative to the skill directory inside the repository. Initially expose only name, description, and path. Load full content when selected, log its content hash, and record when it is used. Malformed metadata or duplicate skill names produce an actionable validation error.

Read root `AGENTS.md`, then applicable nested `AGENTS.md` files before operations in each subtree. More specific instructions govern that subtree. User plan/amendment instructions outrank repository guidance; neither overrides application limits or the configured denylist. Conflicts that cannot be resolved with this hierarchy stop the run. Treat ordinary source code, tool output, and documentation as task data rather than new authority.

Preserve instruction and loaded-skill snapshots across checkpoints. Detect their modification on resume or before reusing a cached scope; reload changed content and record the change. Context compaction must not drop applicable constraints.

## 10. Model integration, context, and caching

Configure the AI SDK OpenAI-compatible provider explicitly; no implicit cloud gateway, provider fallback, or model substitution. Start with Chat Completions streaming and native tool calling as the required interoperability surface. Use the same configured model for execution and compaction in v1.

Preflight verifies endpoint access, selected-model availability, streaming, a valid tool call and tool-result round trip, and usable budget accounting when a token limit is set. A server calling itself OpenAI-compatible is not sufficient evidence. Fail before target modification if required capabilities are missing. Preflight inference consumes the run budget.

Context construction keeps application instructions and stable tool schemas first, followed by stable plan/repository context and append-only conversation content. Keep timestamps, changing progress, and transient output out of the stable prefix. Canonicalize tool ordering and serialization. Preserve the same prefix across eligible calls and resumes. Append newly loaded scope/skill information rather than unnecessarily rebuilding earlier messages.

Prompt caching is a required optimization, not a response memoization layer. Use the configured provider's supported prefix-cache behavior and options; do not send OpenAI-specific cache fields blindly to compatible servers. Record a prefix fingerprint and exposed cached-token/cache-hit metrics. Missing metrics mean unknown, not zero or a proven cache hit. Resume remains correct after server restart or cache eviction; the agent does not attempt to checkpoint server KV memory.

Rapid-MLX documents server-side prefix reuse, while OpenAI documents exact-prefix requirements for its own prompt caching. These inform the stable-prefix design, but the installed rapid-mlx version must be validated live. No fixed speedup is promised. See [Rapid-MLX API](https://rapidmlx.com/docs/api) and [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Before context capacity is reached, compact using the same model. Preserve the original full history on disk plus the summary, source event range, and active-context revision. The summary must retain objective, effective plan, constraints, steps, evidence references, outstanding issues, and relevant process/file state. Keep recent tool exchanges valid and intact. Record cache invalidation caused by compaction. Compaction consumes the same budgets and cannot bypass them; if insufficient budget remains, stop resumably.

The SDK integration should use its supported agent, tool, streaming, lifecycle, cancellation, and stop-condition facilities. Exact version and hooks must be pinned and verified in the first implementation milestone. Reference: [ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) and [OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers).

## 11. Budgets

- At least one positive time/token total is mandatory, from configuration or CLI. If both are set, either can stop the run.
- Time means cumulative active execution time, including inference, tools, retries, compaction, and verification. Time spent stopped is excluded. Use monotonic timing within a process and persisted intervals across resumes.
- Tokens mean cumulative input plus output across all model calls, including preflight, retries where incurred, and compaction. Cached input tokens still count as input; reasoning tokens count once within the provider's output total. Do not double-count provider usage subcategories.
- Before each request reserve input tokens and a bounded output allowance against the remaining limit; clamp the output maximum. Use validated token accounting for the selected model. If exact counts are unavailable, a documented conservative upper bound may be used and labeled. An unvalidated character heuristic is insufficient for a hard token limit.
- Persist reservations before sending requests. Reconcile with actual usage after completion. Missing usage after interruption retains the conservative reservation rather than treating consumption as zero. If no safe accounting method exists, reject token-limited execution; a configured time-only run remains possible.
- Enforce the active-time deadline with cancellation, not only at iteration boundaries. Stop new work at exhaustion, cancel in-flight requests/commands, and checkpoint with a budget stop reason.
- Cleanup has a bounded grace period and may extend wall-clock exit latency; it cannot start new task work. An external model server may continue computation after client cancellation; record uncertain usage rather than claiming exact server-side enforcement.
- Resume retains consumed time/tokens and remaining totals. `--max-time 2h` replaces the total allowance with two hours, not two additional hours. An exhausted run requires an explicit increase above consumption before continuing.

## 12. Durable state and recovery

Store all runs centrally, defaulting to `~/.code-generator/runs/<run-id>/`. Use owner-only directory/file permissions. Keep a versioned append-only event journal and atomic checkpoint snapshots; large outputs live in referenced artifacts.

Suggested layout:

```text
run.json                 # identity, paths, versions, resolved non-secret config
plan.original.md         # immutable submitted plan
amendments.jsonl         # resume instructions and effective-plan revisions
events.jsonl             # ordered durable journal
checkpoint.json          # reconstructable state snapshot
artifacts/               # full model/tool output and evidence
report.json              # machine-readable terminal report
report.md                # readable terminal report
```

Persist run ID, state, event sequence, plan revision, step/criterion states, conversation, compaction records, tool calls/results, pending actions, process identities, budget totals/usage/reservations, initial/current Git metadata, and stop information.

Write and flush action intent before any side effect; write the result before marking it complete. Persist streamed output incrementally and active-time heartbeats at least once per second. Atomic replacement prevents partial snapshots. Recovery tolerates an incomplete final journal record, but unexplained corruption causes an error without overwriting evidence. Reserve/reconcile the final heartbeat interval conservatively so crashes do not grant repeated free execution time.

Resume means continuation of durable logical state, not restoration of an in-flight model generation or exact operating-system process state. Recover pending actions by checking file hashes/diffs, command output, process identity, Git state, and applicable checks. Never blindly replay an action with an uncertain side effect, including pushes or installation commands. Stop with `uncertain_action` when available evidence cannot establish its outcome.

Use tracked process groups and a supervisor/wrapper capable of recording command completion independently of the main agent. Cleanup after a hard kill cannot be guaranteed immediately; recovery must detect surviving owned processes and reconcile/stop them without killing unrelated processes or trusting a reused PID.

Ctrl+C and SIGTERM stop new work, cancel requests, terminate managed processes with a bounded grace period, save state, and report interruption. Every normal terminal outcome cleans up managed background processes. Resume restarts services only when needed. Do not automatically roll back repository changes.

## 13. Output and exit states

Human output streams run ID, working directory, current step, model text, tool activity, check results, budget use, and stop information. No internal/private model reasoning is required; retain reasoning fields only when actually exposed by the provider. Full received model/tool output is retained locally, while application-generated logs exclude credentials. Commands may print secrets; raw captured output can therefore contain them. No automatic log upload or retention deletion in v1.

JSON mode emits versioned newline-delimited events on stdout only; command stdout/stderr is encoded in events or referenced artifacts rather than mixed into the stream. Diagnostics unrelated to the event protocol go to stderr. Each event carries schema version, sequence, timestamp, run ID, type, and payload. Key types include run start/resume, model delta, tool intent/result, progress, verification, compaction, budget, and terminal report.

| Exit code | Terminal category | Meaning |
| --- | --- | --- |
| 0 | `succeeded` | All steps and final criteria verified. |
| 2 | `invalid_input` | Invalid arguments, configuration, plan, or target. |
| 3 | `blocked` | Ambiguity, policy denial, missing prerequisite, incompatible model, repeated no-progress failure, or uncertain side effect. |
| 4 | `budget_exhausted` | Active-time or token allowance exhausted. |
| 5 | `internal_error` | Unexpected application/persistence failure; include recovery guidance. |
| 6 | `locked` | Another process owns the target. |
| 130 | `interrupted` | SIGINT. |
| 143 | `interrupted` | SIGTERM. |

Terminal reports contain completed/remaining steps, criterion results and evidence, changed paths and Git references when available, budget consumption and uncertainty, a specific reason code and explanation, pending/uncertain actions, artifact location, and an executable resume example when applicable. Status distinguishes running from stale/interrupted state. Hard crashes may leave no terminal report; `status` and `resume` must expose and recover that condition honestly.

## 14. Verification and release acceptance

Use automated unit/component tests for deterministic controller behavior. Test doubles are permissible at this level only; they do not qualify as end-to-end evidence.

**Every end-to-end test must run against a live rapid-mlx server, never a mock, prerecorded model response, or substituted hosted model.** Missing server/model means the E2E suite fails its prerequisite check; it cannot silently skip, fall back, or report success. Release validation requires the live suite to pass. Record server version, model ID, SDK version, fixture revision, settings, and run artifacts for reproducibility. The human supplies the live endpoint/model; the agent does not install or reconfigure the server as part of this specification task.

| ID | Release acceptance |
| --- | --- |
| R01 | Packaged CLI runs through `npx` on the target Mac Studio; all four commands and help work without interactive input. |
| R02 | Invalid plan/configuration/model fails before target modification; valid plans retain original text and stable IDs. |
| R03 | Live model completes a small real coding fixture and all declared final checks; code changes and evidence are inspectable. |
| R04 | Live model fixes an ordinary failing test, while an ambiguous-plan fixture stops with an actionable explanation. |
| R05 | Denylisted commands never execute through shell, skill scripts invoked directly, or acceptance-command entry points; rule and reason are recorded. |
| R06 | Injected interruption before/after side effects and during output capture preserves recoverable state; uncertain actions stop rather than replay. Live E2E exercises crash and resume on a real coding task. |
| R07 | Resumption with CLI amendments preserves original history, updates affected steps, invalidates stale evidence, and retains budget consumption. |
| R08 | Time/token exhaustion and explicit total increases work across resumes, including preflight, compaction, cached tokens, and uncertain usage. |
| R09 | Directory locks reject overlapping runs and allow separate repositories/worktrees; stale locks require ownership checks. |
| R10 | Direct mode preserves unrelated dirty files; worktree mode isolates changes and retains the worktree; commits/pushes require explicit instructions. |
| R11 | Only `.agents/skills` is discovered; skills load progressively; nested `AGENTS.md` instructions affect the correct files. |
| R12 | Live repeated-prefix requests demonstrate actual server cache reuse through exposed usage or server metrics/logs. Record evidence; timing alone is not proof. Missing observability blocks caching acceptance until an installed-server-compatible measurement is provided. |
| R13 | Context compaction permits continued execution without losing constraints/evidence, and records the preserved full history. |
| R14 | Managed foreground/background processes are cleaned up on terminal outcomes; orphan recovery identifies only owned processes. |
| R15 | JSON events parse independently, exit codes match reports, and full outputs remain inspectable without credentials in generated logs. |
| R16 | Completion cannot succeed with a missing/failed criterion, stale evidence, or unfinished step, regardless of the model's final statement. |

Use disposable fixture repositories and harmless local Git remotes for tests. Fault injection may control process termination or controller boundaries, but E2E inference always uses the live server. Validate outcomes, not exact natural-language transcripts. Do not add a performance speedup target before measuring the intended model/server configuration.

## 15. Implementation sequence and remaining setup

1. Establish TypeScript packaging and CLI/config/plan schemas; pin Node/SDK versions and validate live rapid-mlx tool calling, usage accounting, and cache observability.
2. Implement state journal, checkpoints, locks, budgets, and recovery invariants.
3. Implement tools, policy checks, process supervision, skills, and scoped instructions.
4. Integrate the SDK loop, progressive context, caching, compaction, and final completion gate.
5. Add reports, JSON events, live E2E fixtures, and `npx` packaging verification.

Confirmed setup: rapid-mlx at `http://127.0.0.1:8001/v1`, model `qwen3.6-35b-8bit`, advertised context capacity 262144 tokens, and a one-hour active-time default. Live integration results are recorded in IMPLEMENTATION.md. The package uses `@nicknance/code-generator` locally; npm publishing and namespace availability remain unverified. Existing personal skill collections can be tried through repository-local `.agents/skills`; the automated suite validates representative skill fixtures.
