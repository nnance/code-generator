# Implementation and verification

The v1 CLI is implemented locally. The initial documents and each implementation milestone are committed separately. No package has been published and no remote repository has been configured.

## Milestones

| Milestone | Result |
| --- | --- |
| Starting documents | `49baa7c` — product specification, README, and plan template. |
| 1. CLI and model foundation | `a70a132` — configuration, plan validation, CLI surface, and live SDK tool-call round trip. |
| 2. State and budgets | `fdae093` — durable journal, checkpoints, directory locks, cumulative accounting, and recovery primitives. |
| 3. Coding tools | `b39f8de` — file/search/grep tools, command policy, supervised processes, skills, and scoped instructions. |
| 4. Agent execution | `761989e` — SDK loop, amendments, caching, compaction, and independent acceptance verification. |
| 5. Validation and packaging | Final milestone commit — extended live fixtures, recovery hardening, reports, configuration example, and local npx packaging. |

## Original v1 validation environment

- Node.js 26.4.0 on macOS; package declares Node.js >=22.
- Rapid-MLX 0.12.18, as reported by server metrics.
- Endpoint `http://127.0.0.1:8001/v1`.
- Model alias `qwen3.6-35b-8bit`, canonical ID `mlx-community/Qwen3.6-35B-A3B-8bit`.
- Advertised context capacity: 262144 tokens.
- Vercel AI SDK 7.0.90, OpenAI-compatible provider 3.0.44.
- TypeScript 5.9.3, Zod 4.3.6, YAML 2.8.3. YAML supports existing skill frontmatter, including multiline descriptions.

## Checks

The component suite contains 13 passing tests covering plan/config validation, partial or corrupt journals, retained token reservations, overlapping locks, supervised command recovery, test-environment isolation, command restrictions, recursive globs, and local skill discovery.

The seven live E2E scenarios cover:

1. Repairing a real coding fixture, preserving tests, running acceptance commands, and recording independently verified evidence. The run also exercises a token budget and preserves unrelated dirty Git changes.
2. A hard process crash after a code change, followed by resume with an instruction amendment and retained budgets/history.
3. Stopping an ambiguous plan before edits, with an actionable explanation.
4. Exhausting an active-time budget and refusing to reset it on resume.
5. Context compaction with retained full history and exact instruction/skill snapshots.
6. Worktree isolation, repository skill loading, and nested `AGENTS.md` rules.
7. Streaming native tool calls, actual usage accounting, and observed prompt-cache reuse.

The full live suite passed. Targeted live checks cover the final recovery/context changes and preserving unrelated existing Git edits. End-to-end inference always uses the real rapid-mlx server; there is no mock, recording, hosted fallback, or silent missing-server skip.

The local npm tarball builds successfully and its `code-generator --help` command runs through `npx`. Dependency audit reports no known vulnerabilities. Markdown links and Git whitespace checks are checked before the final milestone commit.

```sh
npm test
npm run test:e2e
npm pack
npx --yes --package ./nicknance-code-generator-0.1.0.tgz code-generator --help
```

Diagnostic run data stays in temporary fixture directories. `.test-artifacts/` contains references and live connectivity evidence and is excluded from Git.

## Operational limits

- Token enforcement reserves the full server-advertised context plus the requested output allowance, then replaces that reservation with actual usage. Small token allowances may stop before inference. The default uses one hour of active time without a token cap.
- Resume preserves durable logical state. Interrupted generation restarts from recorded context; uncertain side effects require explicit, evidence-backed resolution instructions. It does not restore server KV memory or an exact process image.
- Prompt cache reuse is measured when the server exposes it. Correctness does not depend on a cache surviving a server restart or eviction.
- The command denylist prevents common accidents; it is not a shell sandbox. Commits and pushes require explicit plan/amendment authorization.
- Validation used representative local fixtures and the specified model/server. Additional models, large production repositories, and personal skill collections have not been certified by these tests.
- The npm namespace is a local packaging choice, not a claim that a package has been published or that the namespace is available.

## Current server configuration

The default model is now `qwen3.8-27b-4bit` at the same port 8001. Its canonical server ID is `rapid-mlx/Qwen3.8-27B-4bit-MTP-MLX`; the advertised context remains 262144 tokens. The full v1 results above describe the original Qwen3.6 validation, not a full rerun on Qwen3.8.

The live Qwen3.8 connectivity check passed: streaming native tool calls, input/output usage, and observed prefix-cache reuse. The TypeScript build also passed.
