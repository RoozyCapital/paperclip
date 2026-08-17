# Design Spec: Antigravity CLI Adapter (`antigravity_local`) & CI/CD Deployment

## 1. Overview & Goal

This specification defines the implementation of a new first-class local agent adapter for the **Antigravity CLI** (`agy`) in Paperclip, named `@paperclipai/adapter-antigravity-local` (type: `antigravity_local`), along with Dockerfile and Docker Compose configurations for containerized CI/CD deployment.

Antigravity CLI is Google's terminal-based AI development agent interface. This adapter allows Paperclip to orchestrate `agy` sessions locally with multi-turn session persistence, runtime skills injection, model selection, live streaming output parsing, and preflight environment diagnostics.

---

## 2. Architecture & Components

The adapter follows Paperclip's standard 4-export pattern (`.`, `./server`, `./ui`, `./cli`):

```
packages/adapters/antigravity-local/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                      # Shared metadata (type, label, models, profiles, doc)
    ├── server/
    │   ├── index.ts                  # Server exports: execute, testEnvironment, sessionCodec, skills
    │   ├── execute.ts                # Process spawner for agy CLI (runs, prompts, sessions, retries)
    │   ├── parse.ts                  # JSON/JSONL stream parser & error diagnostics
    │   ├── skills.ts                 # Paperclip skills symlink synchronization (~/.gemini/skills & ~/.antigravity/skills)
    │   ├── test.ts                   # Environment test diagnostics (command resolvability, auth check, cwd)
    │   └── utils.ts                  # Safe parsing and text utilities
    ├── ui/
    │   ├── index.ts                  # UI exports: parseStdoutLine, buildConfig
    │   ├── parse-stdout.ts           # Line-by-line parser to TranscriptEntry[]
    │   └── build-config.ts           # CreateConfigValues -> adapterConfig JSON serializer
    └── cli/
        ├── index.ts                  # CLI exports: formatStdoutEvent
        └── format-event.ts           # Terminal pretty printer for `paperclipai run --watch`
```

---

## 3. Specifications

### 3.1 Metadata & Models (`src/index.ts`)
- **`type`**: `"antigravity_local"`
- **`label`**: `"Antigravity CLI"`
- **Default Command**: `"agy"`
- **Default Models**:
  - `auto`: `"Auto"` (Default)
  - `gemini-3.7-pro`: `"Gemini 3.7 Pro"`
  - `gemini-3.7-flash`: `"Gemini 3.7 Flash"`
  - `gemini-3.1-pro-preview`: `"Gemini 3.1 Pro Preview"`
  - `gemini-2.5-pro`: `"Gemini 2.5 Pro"`
  - `gemini-2.5-flash`: `"Gemini 2.5 Flash"`
  - `gemini-2.5-flash-lite`: `"Gemini 2.5 Flash Lite"`
- **Model Profiles**:
  - `cheap`: Uses `gemini-2.5-flash-lite` for cost-effective background execution.
- **`agentConfigurationDoc`**:
  Comprehensive routing documentation instructing LLMs when to choose `antigravity_local` (local execution of `agy`, session resume, skills support) and negative routing criteria.

### 3.2 Server Execution & Runtime (`src/server/`)
- **Process Spawning**:
  - Resolves `agy` command from PATH (or configured override).
  - Prepares non-interactive invocation using `--prompt "<rendered-prompt>"`.
  - Injects headless environment variables (`NO_BROWSER=1`, `TERM=xterm-256color`, `COLORTERM=truecolor`).
  - Injects standard `PAPERCLIP_*` environment variables (`PAPERCLIP_API_KEY`, `PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, etc.).
- **Session Management**:
  - Resumes active sessions with `--resume <sessionId>` when current working directory matches saved session `cwd`.
  - Detects stale/unknown session errors and retries fresh with `clearSession: true`.
- **Skills Injection**:
  - Injects Paperclip skills into `~/.gemini/skills/` and `~/.antigravity/skills/` via safe symlinks without modifying the project's working directory.
- **Environment Diagnostics (`testEnvironment`)**:
  - Checks if `agy` command is resolvable in PATH.
  - Checks directory accessibility.
  - Checks for API keys (`GEMINI_API_KEY`, `GOOGLE_API_KEY`) or local login credentials.

### 3.3 UI Components & Registries (`src/ui/` & `ui/src/`)
- **UI Form Fields**:
  - `ui/src/adapters/antigravity-local/config-fields.tsx` implementing `AdapterConfigFieldsProps`.
  - Allows selecting from model dropdown or typing custom model ID.
  - Optional fields: instructions file, permission mode, command override, timeouts.
- **Transcript Parser**:
  - Streams tool calls, thoughts, assistant messages, and usage stats into the Paperclip run viewer.

### 3.4 CLI Event Formatter (`src/cli/`)
- Pretty-prints live agent streaming events for `paperclipai run --watch`.

### 3.5 System Registries & Constants
- Register `antigravity_local` in:
  - `packages/shared/src/constants.ts` (`AGENT_ADAPTER_TYPES`)
  - `server/src/adapters/registry.ts` (`adaptersByType`)
  - `ui/src/adapters/registry.ts` (`adaptersByType`)
  - `cli/src/adapters/registry.ts` (`adaptersByType`)

### 3.6 Dockerfile & Docker Compose for CI/CD Deployment
- **Dockerfile**:
  - Multi-stage build copies `packages/adapters/antigravity-local/package.json`.
  - Installs global CLI dependencies including `agy` / `@google/gemini-cli` / `@anthropic-ai/claude-code` / `@openai/codex` / `opencode-ai`.
- **Docker Compose (`docker/docker-compose.yml` / CI/CD)**:
  - Orchestrates Postgres DB + Paperclip Server container.
  - Sets up persistent volume for `/paperclip` data and user credentials (`~/.gemini`, `~/.antigravity`).
  - Passes environment variables (`GEMINI_API_KEY`, `GOOGLE_API_KEY`, `BETTER_AUTH_SECRET`, `PORT`, `DATABASE_URL`).

---

## 4. Verification Plan

1. **Unit Tests**:
   - Adapter output parsing test (`parse.test.ts`).
   - Session codec serialization/deserialization test.
   - Config builder test (`build-config.test.ts`).
   - Environment test diagnostics check (`test.test.ts`).
2. **Server Integration Tests**:
   - Register in `server/src/__tests__/adapter-session-codecs.test.ts`.
   - Verify server adapter module lookup in `server/src/adapters/registry.ts`.
3. **Workspace Build & Typecheck**:
   - `pnpm -r typecheck`
   - `pnpm test`
   - `pnpm build`
