# Antigravity CLI (`antigravity_local`) Adapter & CI/CD Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@paperclipai/adapter-antigravity-local` package (`antigravity_local`) for running Antigravity CLI (`agy`) with multi-turn session persistence, skills injection, and model selection, register it across Server, UI, and CLI, and provide Dockerfile & Docker Compose CI/CD deployment configurations.

**Architecture:** A standalone adapter package conforming to Paperclip's 4-tier export architecture (`.`, `./server`, `./ui`, `./cli`), connected to the shared adapter registries, UI form components, and containerized Docker images.

**Tech Stack:** TypeScript, Node.js, React, Vitest, Docker, Docker Compose, Drizzle/PGlite.

## Global Constraints
- Naming: Adapter type `antigravity_local`, Package name `@paperclipai/adapter-antigravity-local`.
- Default command: `agy`.
- Follow Paperclip 4-export pattern (`.`, `./server`, `./ui`, `./cli`).
- Follow design token rules for UI components per `DESIGN.md`.
- Ensure non-interactive headless execution safe for CI/CD and production container environments.

---

### Task 1: Add `antigravity_local` to Shared Constants & Types

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Test: `packages/shared` tests or typecheck

- [ ] **Step 1: Update AGENT_ADAPTER_TYPES in `packages/shared/src/constants.ts`**
Add `"antigravity_local"` to `AGENT_ADAPTER_TYPES`.

- [ ] **Step 2: Verify typecheck**
Run `pnpm --filter @paperclipai/shared typecheck`

---

### Task 2: Scaffold `@paperclipai/adapter-antigravity-local` Package

**Files:**
- Create: `packages/adapters/antigravity-local/package.json`
- Create: `packages/adapters/antigravity-local/tsconfig.json`
- Create: `packages/adapters/antigravity-local/vitest.config.ts`
- Create: `packages/adapters/antigravity-local/src/index.ts`

- [ ] **Step 1: Create `package.json`**
Configure package name `@paperclipai/adapter-antigravity-local`, exports for `.`, `./server`, `./ui`, `./cli`, dependencies on `@paperclipai/adapter-utils` and `picocolors`.

- [ ] **Step 2: Create `tsconfig.json` and `vitest.config.ts`**
Extend root config and setup vitest.

- [ ] **Step 3: Create `src/index.ts`**
Export `type = "antigravity_local"`, `label = "Antigravity CLI"`, `DEFAULT_ANTIGRAVITY_LOCAL_MODEL = "auto"`, models list (Gemini 3.7 Pro, 3.7 Flash, 3.1 Pro Preview, 2.5 Pro, 2.5 Flash, 2.5 Flash Lite, Auto), `modelProfiles`, and `agentConfigurationDoc`.

- [ ] **Step 4: Verify package build**
Run `pnpm --filter @paperclipai/adapter-antigravity-local typecheck`

---

### Task 3: Implement Server Module for Antigravity Adapter

**Files:**
- Create: `packages/adapters/antigravity-local/src/server/utils.ts`
- Create: `packages/adapters/antigravity-local/src/server/parse.ts`
- Create: `packages/adapters/antigravity-local/src/server/skills.ts`
- Create: `packages/adapters/antigravity-local/src/server/test.ts`
- Create: `packages/adapters/antigravity-local/src/server/execute.ts`
- Create: `packages/adapters/antigravity-local/src/server/index.ts`

- [ ] **Step 1: Create `utils.ts` and `parse.ts`**
Implement output streaming JSON/JSONL parser for `agy`, token usage extraction, error detection, and `isAntigravityUnknownSessionError`.

- [ ] **Step 2: Create `skills.ts`**
Implement Paperclip skills symlinking to `~/.gemini/skills/` and `~/.antigravity/skills/`.

- [ ] **Step 3: Create `test.ts`**
Implement `testEnvironment` preflight diagnostic checks (binary in PATH, working dir, credentials).

- [ ] **Step 4: Create `execute.ts`**
Implement process spawner using `runChildProcess`, session resumption via `--resume <sessionId>`, headless env vars, template prompt rendering, and retry handling.

- [ ] **Step 5: Create `server/index.ts`**
Export `execute`, `testEnvironment`, `sessionCodec`, `syncSkills`, `listSkills`, and parsing helpers.

---

### Task 4: Implement UI & CLI Modules

**Files:**
- Create: `packages/adapters/antigravity-local/src/ui/parse-stdout.ts`
- Create: `packages/adapters/antigravity-local/src/ui/build-config.ts`
- Create: `packages/adapters/antigravity-local/src/ui/index.ts`
- Create: `packages/adapters/antigravity-local/src/cli/format-event.ts`
- Create: `packages/adapters/antigravity-local/src/cli/index.ts`
- Create: `ui/src/adapters/antigravity-local/config-fields.tsx`
- Create: `ui/src/adapters/antigravity-local/index.ts`

- [ ] **Step 1: Implement `src/ui/parse-stdout.ts` and `src/ui/build-config.ts`**
Parse lines into `TranscriptEntry[]` (init, assistant, thinking, tool_call, tool_result, result) and convert form state into `adapterConfig`.

- [ ] **Step 2: Implement `src/cli/format-event.ts`**
Format stream events for terminal output in `paperclipai run --watch`.

- [ ] **Step 3: Implement React `ConfigFields` component**
Create `ui/src/adapters/antigravity-local/config-fields.tsx` and export `antigravityLocalUIAdapter` in `ui/src/adapters/antigravity-local/index.ts`.

---

### Task 5: Register Adapter in Server, UI, and CLI

**Files:**
- Modify: `server/package.json`
- Modify: `ui/package.json`
- Modify: `cli/package.json`
- Modify: `server/src/adapters/registry.ts`
- Modify: `ui/src/adapters/registry.ts`
- Modify: `cli/src/adapters/registry.ts`

- [ ] **Step 1: Add `@paperclipai/adapter-antigravity-local` dependency to `server/package.json`, `ui/package.json`, and `cli/package.json`**
- [ ] **Step 2: Register in `server/src/adapters/registry.ts`**
Import server module and add `antigravityLocalAdapter` to `adaptersByType`.
- [ ] **Step 3: Register in `ui/src/adapters/registry.ts`**
Import UI adapter and add `antigravityLocalUIAdapter` to `adaptersByType`.
- [ ] **Step 4: Register in `cli/src/adapters/registry.ts`**
Import CLI formatter and add `antigravity_local` to CLI `adaptersByType`.

---

### Task 6: Add Tests for Antigravity Adapter

**Files:**
- Create: `packages/adapters/antigravity-local/src/server/parse.test.ts`
- Create: `packages/adapters/antigravity-local/src/ui/build-config.test.ts`
- Modify: `server/src/__tests__/adapter-session-codecs.test.ts`

- [ ] **Step 1: Write parser tests in `parse.test.ts`**
Test JSON/JSONL output parsing, error handling, and session resumption.
- [ ] **Step 2: Write config builder tests in `build-config.test.ts`**
Test `buildAntigravityLocalConfig` with default and custom values.
- [ ] **Step 3: Add `antigravity_local` codec test in `adapter-session-codecs.test.ts`**
Verify serialize/deserialize round-trip.
- [ ] **Step 4: Run adapter tests**
Run `pnpm --filter @paperclipai/adapter-antigravity-local test` and `pnpm --filter @paperclipai/server test`

---

### Task 7: Update Dockerfile & Docker Compose for CI/CD Deployment

**Files:**
- Modify: `Dockerfile`
- Modify: `docker/docker-compose.yml`

- [ ] **Step 1: Update `Dockerfile`**
- Add `COPY packages/adapters/antigravity-local/package.json packages/adapters/antigravity-local/` in deps stage.
- Ensure CLI dependencies layer in production stage includes `agy` / Google AI tools.
- [ ] **Step 2: Update `docker/docker-compose.yml`**
- Ensure environment variables support `GEMINI_API_KEY` / `GOOGLE_API_KEY` and volume mounts for credentials persistence (`~/.gemini`, `~/.antigravity`).

---

### Task 8: Full Verification

- [ ] **Step 1: Run workspace typecheck**
Run `pnpm -r typecheck`
- [ ] **Step 2: Run test suites**
Run `pnpm test`
- [ ] **Step 3: Run full build**
Run `pnpm build`
