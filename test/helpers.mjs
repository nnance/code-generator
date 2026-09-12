export function fixturePlan(command = 'node --test', objective = 'Fix add(a,b) so it returns the sum of two numbers.') {
  return `# Implementation Plan: Fix addition

Plan format: 1

## Objective

${objective}

## Scope and constraints

Modify only add.js. Preserve test files. Leave changes uncommitted; do not push.

## Ordered steps

### Step S1: Fix addition

Action: Read add.js and tests. Correct the implementation without changing the tests.

Acceptance criteria: AC1

## Acceptance criteria

### AC1: Addition tests pass

Kind: command

Working directory: .

Command:

\`\`\`sh
${command}
\`\`\`

Expected exit code: 0

Expected result: All addition tests pass with zero failures.

Evidence: Full test output and exit status.

## Exit criteria

- Every step is completed with evidence.
- Every acceptance criterion passes against the final state.
- No unresolved blocker remains.
`;
}
