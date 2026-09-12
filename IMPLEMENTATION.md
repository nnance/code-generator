# Implementation progress

Each milestone is committed separately. End-to-end tests always use the live rapid-mlx server; unit/component tests may isolate deterministic behavior.

1. CLI/configuration/plan foundation and live SDK compatibility — complete. SDK 7.0.90, compatible provider 3.0.44; live tool-result round trip passed and reported 491 cached input tokens. Server metrics identify rapid-mlx 0.12.18.
2. Durable state, checkpoints, locks, budgets, and recovery — complete foundation. Seven component tests cover journal truncation/corruption, pending action recovery, cumulative reservations, and overlapping locks. Side-effect reconciliation is integrated with tools in the next milestone.
3. Tools, command policy, process supervision, skills, and scoped instructions — complete foundation. Ten component tests pass, including a real supervised shell command and recovery from its durable result.
4. SDK loop, caching, compaction, and completion gate.
5. Reports, JSON events, live E2E fixtures, and packaging.

Operational baseline: `http://127.0.0.1:8001/v1`, model `qwen3.6-35b-8bit`, advertised context 262144 tokens, one-hour cumulative active-time default.
