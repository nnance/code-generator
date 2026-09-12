# Implementation Plan: Add a standalone version flag

Plan format: 1

## Objective

Add --version to the Code Generator CLI. It must print the version from the installed package.json followed by one newline and exit successfully without loading user configuration or contacting a model server.

## Scope and constraints

- Target assumptions: Existing Node.js/TypeScript Code Generator repository; npm and the live rapid-mlx server are available. The worktree initially has no node_modules or dist. Run npm ci --ignore-scripts to install the existing locked dependencies, then build as needed. Do not change package.json or package-lock.json.
- In scope: src/cli.ts and one new test/cli-version.test.mjs file only. Document --version in the existing CLI help text.
- Out of scope: Changes to the agent loop, configuration defaults, model connectivity, other source files, existing tests, dependencies, or package metadata.
- Implementation constraints: Read the version dynamically from the package.json belonging to the executable; never hardcode 0.1.0. It must work from any current working directory, including the installed npm package. Handle --version before dispatching commands or reading config. When --version and --help are both present, print the version. Other behavior must remain unchanged. Do not contact the LLM to implement the flag's runtime behavior.
- Existing work: Clean source checkout; the agent is operating in an isolated worktree. Preserve existing files outside the stated scope. Generated ignored build/dependency files are allowed.
- Delivery actions: Leave changes uncommitted; do not push or merge. Do not create commits.
- Blockers: Stop with an explanation if implementation requires changes outside scope or existing tests fail for reasons unrelated to this feature. The local model server may remain running; offline flag behavior is tested by supplying an unreachable endpoint and nonexistent config path, not by stopping the server.

## Ordered steps

### Step S1: Implement version dispatch

Action: Inspect src/cli.ts and package.json. Add the --version boolean flag and print the package version with one newline before help or command dispatch. Resolve package.json relative to the module location so installed execution and unrelated working directories work. Include --version in help. Use Node built-ins and preserve existing behavior.

Acceptance criteria: AC1, AC2

### Step S2: Add version regression tests

Action: Add test/cli-version.test.mjs using node:test. Derive the expected version from package.json. Exercise --version, --version with --help, execution from an unrelated directory, and --version with a missing --config path plus an unreachable --base-url. Assert exit success, exact stdout and empty stderr. Assert --help includes --version. Run the existing component suite without modifying existing tests.

Acceptance criteria: AC1, AC2

## Acceptance criteria

### AC1: All component and version tests pass

Kind: command

Working directory: .

Command:

```sh
npm test
```

Expected exit code: 0

Expected result: TypeScript builds successfully. Existing unit/component tests and the new version regression tests all pass, with no failures. The new tests explicitly cover exact version output, help documentation, precedence, unrelated cwd, and invalid configuration/unreachable endpoint independence.

Evidence: Full npm test stdout/stderr, exit status, and references to the new test assertions.

### AC2: Built CLI reports the package version independently

Kind: command

Working directory: .

Command:

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import {readFileSync} from "node:fs"; import {spawnSync} from "node:child_process"; import {resolve} from "node:path"; import {tmpdir} from "node:os"; const version=JSON.parse(readFileSync("package.json","utf8")).version; const result=spawnSync(process.execPath,[resolve("dist/cli.js"),"--version","--help","--config","/definitely-missing-code-generator-config.json","--base-url","http://127.0.0.1:1/v1"],{cwd:tmpdir(),encoding:"utf8",timeout:5000}); assert.equal(result.status,0); assert.equal(result.stdout,version+"\n"); assert.equal(result.stderr,""); console.log("Standalone version flag verified");'
```

Expected exit code: 0

Expected result: Prints Standalone version flag verified after confirming exact dynamic version output, successful exit, empty stderr, and independence from cwd/config/model server.

Evidence: Command output and exit status, plus src/cli.ts implementation showing package-relative resolution and version dispatch before runtime configuration.

## Exit criteria

- Every ordered step is completed with recorded evidence.
- Every acceptance criterion passes against the final state.
- No unresolved blocker, ambiguity, or uncertain side effect remains.
- Only src/cli.ts and test/cli-version.test.mjs have tracked changes; generated ignored dependency/build files are allowed.
- Changes remain uncommitted in the isolated worktree. Do not push or merge.
