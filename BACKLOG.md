# Backlog

Open work toward reliable execution of the strict implementation plan contract in [PLAN_TEMPLATE.md](PLAN_TEMPLATE.md). Product direction and intended behavior are defined in [PRODUCT_SPEC.md](PRODUCT_SPEC.md); entries here are not implemented features.

## BL-001: Distinguish contract gaps from runtime prerequisites

Status: Open

Source: [Model-directed skill validation](IMPLEMENTATION.md#model-directed-skill-validation-2026-09-12), run `8df91a00-6414-497d-a3dc-ac8de095a1ba`.

Observed: Assessment rejected a valid conditional prerequisite gate as ambiguity before attempting filesystem inspection. Even after the external contract was supplied, assessment required its contents quoted in the plan. Multiple amendments were needed to permit execution. The validation therefore did not exercise a missing-file tool failure.

Desired behavior: Validate the plan's structure and behavioral consistency before implementation. Distinguish missing specification decisions from a well-defined instruction to inspect a prerequisite and stop if it is unavailable. Permit repository inspection where the plan defines how its result governs execution; do not require redundant quotation of inspectable files. If the contract has a real gap, identify the relevant section or step, explain the missing or conflicting requirement, and state what clarification is needed without inventing the answer.

Acceptance:

- A template-conforming plan with a deterministic prerequisite gate passes contract validation and reaches the prerequisite check.
- A missing prerequisite produces an actionable blocker before code changes; supplying it permits same-run resume without weakening acceptance criteria.
- A present, consistent contract can be read without requiring its contents duplicated in the plan.
- Contradictory behavior or an unresolved product decision still stops before implementation with specific corrective feedback.
- Live rapid-mlx regression coverage distinguishes these cases and records the model and configuration used.

## BL-002: Report changed paths accurately after pre-execution stops

Status: Open

Source: [Model-directed skill validation](IMPLEMENTATION.md#model-directed-skill-validation-2026-09-12), same run as BL-001.

Observed: The non-Git fixture's changed-path report included all target files after pre-execution stops, although the worker edited only `greeting.js`. Review required independent baseline hashes and chronological write evidence.

Desired behavior: Preserve a reliable baseline through early stops and resume. Make changed-path reports distinguish observed filesystem changes from edits attributable to the worker, including files supplied externally while stopped. If a baseline is unavailable, report that uncertainty explicitly instead of implying that all existing files were changed by the agent.

Acceptance:

- A non-Git run stopped before edits does not report unchanged pre-existing files as changed.
- After resume, unchanged checks and package metadata remain excluded from changed paths.
- An externally supplied prerequisite is distinguishable from worker edits; the worker's code change is correctly identified.
- Baseline recovery and unknown-baseline cases have regression coverage, with a live rapid-mlx stop/resume scenario verifying the final report against independent hashes and action evidence.
