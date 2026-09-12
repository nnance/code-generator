# Implementation Plan: <concrete task title>

Plan format: 1

<!-- Replace every angle-bracket placeholder before submission. Keep required
headings and field labels. Duplicate Step/AC blocks as needed. This file is a
template, not an executable plan until populated. -->

## Objective

<Describe the observable result, who/what uses it, and the specific behavior expected.>

## Scope and constraints

- Target assumptions: <existing project, relevant runtime, required installed tools and services>
- In scope: <features, files, or components that may change>
- Out of scope: <explicit exclusions>
- Implementation constraints: <interfaces, architecture, dependencies, compatibility requirements>
- Existing work: <known uncommitted changes to preserve, or "No known pre-existing changes">
- Delivery actions: <"Leave changes uncommitted; do not push" or explicit commit/push instructions>
- Blockers: <decisions or unavailable prerequisites that must cause a stop instead of a guess>

## Ordered steps

### Step S1: <short action title>

Action: <Precise change to implement, including relevant paths and behavior.>

Acceptance criteria: AC1

### Step S2: <short action title>

Action: <Precise next change; remove this block if only one step is required.>

Acceptance criteria: AC2

## Acceptance criteria

<!-- Every step must reference at least one AC ID below. All criteria are required
for success and are rechecked against the final state. A zero exit code alone
does not replace the expected-result assertions. Use command criteria wherever
practical; observable criteria must be verifiable without asking a human. -->

### AC1: <behavior verified by an automated check>

Kind: command

Working directory: .

Command:

```sh
<exact non-interactive verification command>
```

Expected exit code: 0

Expected result: <Specific behavior/assertions/output that establish success.>

Evidence: <Command, exit status, full output reference, and any generated artifacts to retain.>

### AC2: <behavior verified through direct observation>

Kind: observable

Procedure: <Exact agent-executable inspection steps, files/data to inspect, and method.>

Expected result: <Objective observable facts, not subjective approval such as "looks good".>

Evidence: <File/line references, tool output, or artifact references demonstrating those facts.>

## Exit criteria

- Every ordered step is completed with recorded evidence.
- Every acceptance criterion passes against the final state, including rerunning all command checks.
- No unresolved ambiguity, blocker, or uncertain side effect remains.
- All scope and implementation constraints are satisfied.
- Requested delivery actions are complete; commits and pushes occur only if explicitly authorized above.
- Managed background processes are stopped before successful exit.

<!-- Budget limits come from user configuration or CLI flags, not this plan.
On failure the agent preserves state and explains the stop. Resume amendments
are supplied through `resume <run-id> --instructions '...'`; editing this source
file does not silently alter a stored run. -->
