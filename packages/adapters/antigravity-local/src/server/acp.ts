import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
  runAdapterExecutionTargetShellCommand,
} from "@paperclipai/adapter-utils/execution-target";
import {
  DEFAULT_ACP_ENGINE_MODE,
  DEFAULT_ACP_ENGINE_NON_INTERACTIVE_PERMISSIONS,
  DEFAULT_ACP_ENGINE_PERMISSION_MODE,
  DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS,
} from "@paperclipai/adapter-utils/acpx-engine/constants";
import type {
  AcpxEngineExecutorOptions,
  AcpxRemoteManagedHomeContext,
  AcpxRemoteManagedHomeResult,
} from "@paperclipai/adapter-utils/acpx-engine/execute";
import {
  asNumber,
  asString,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_ANTIGRAVITY_LOCAL_MODEL } from "../index.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRootDir = path.resolve(moduleDir, "../..");
const MIN_ACP_NODE_VERSION = "20.0.0";

export type AntigravityExecutionEngine = "cli" | "acp";

export interface AntigravityEngineSelection {
  engine: AntigravityExecutionEngine;
  explicit: boolean;
  fallbackReason?: string;
}

type AntigravityEngineResolutionInput =
  Pick<AdapterExecutionContext, "config"> &
  Partial<Pick<AdapterExecutionContext, "executionTarget" | "executionTransport">>;

type AntigravityAcpExecutorOptions = Omit<
  AcpxEngineExecutorOptions,
  "adapterType" | "moduleDir" | "packageRootDir"
>;

type AntigravityAcpExecutor = (ctx: AdapterExecutionContext) => Promise<AdapterExecutionResult>;

function normalizeEngine(value: unknown): AntigravityEngineSelection {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "acp") return { engine: "acp", explicit: true };
  if (raw === "cli") return { engine: "cli", explicit: true };
  return { engine: "acp", explicit: false };
}

export function resolveAntigravityExecutionEngine(config: Record<string, unknown>): AntigravityEngineSelection {
  return normalizeEngine(config.engine);
}

export async function resolveAntigravityExecutionEngineForRun(
  input: AntigravityEngineResolutionInput,
): Promise<AntigravityEngineSelection> {
  const selection = normalizeEngine(input.config.engine);
  if (selection.explicit || selection.engine !== "acp") return selection;

  const fallbackReason = await defaultAntigravityAcpFallbackReason(input);
  if (!fallbackReason) return selection;
  return { engine: "cli", explicit: false, fallbackReason };
}

export function formatAntigravityAcpFallbackMessage(reason: string): string {
  return `[paperclip] Antigravity ACP default unavailable; falling back to Antigravity CLI. ${reason} Set engine=acp to require ACP or engine=cli to silence this fallback.\n`;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function buildAntigravityAcpConfig(config: Record<string, unknown>): Record<string, unknown> {
  const configuredAgentCommand = firstNonEmptyString(config.agentCommand, config.acpAgentCommand);
  const configuredAntigravityCommand = firstNonEmptyString(config.command);
  const agentCommand = configuredAgentCommand ?? (configuredAntigravityCommand ? `${configuredAntigravityCommand} --acp` : undefined);
  const stateDir = firstNonEmptyString(config.stateDir, config.acpStateDir);
  const mode = firstNonEmptyString(config.mode, config.acpMode) ?? DEFAULT_ACP_ENGINE_MODE;
  const permissionMode =
    firstNonEmptyString(config.permissionMode, config.acpPermissionMode) ??
    DEFAULT_ACP_ENGINE_PERMISSION_MODE;
  const nonInteractivePermissions =
    firstNonEmptyString(config.nonInteractivePermissions, config.acpNonInteractivePermissions) ??
    DEFAULT_ACP_ENGINE_NON_INTERACTIVE_PERMISSIONS;
  const warmHandleIdleMs =
    config.warmHandleIdleMs ??
    config.acpWarmHandleIdleMs ??
    DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS;

  const next: Record<string, unknown> = {
    ...config,
    agent: "antigravity",
    mode,
    permissionMode,
    nonInteractivePermissions,
    warmHandleIdleMs,
    ...(agentCommand ? { agentCommand } : {}),
    ...(stateDir ? { stateDir } : {}),
  };
  const model = asString(next.model, "").trim();
  if (!model || model === DEFAULT_ANTIGRAVITY_LOCAL_MODEL) delete next.model;
  return next;
}

/**
 * Host skills dir the shared engine materializes this run's Antigravity skills into.
 * Derived here — inside the adapter boundary — from the same generic `config`
 * the engine reads (`config.env.HOME` else the process home), so the remote seam
 * ships exactly the dir the engine's `prepareAntigravitySkillRuntime` prepared without
 * the engine having to hand a Antigravity-specific path across the seam.
 */
function resolveAntigravitySkillsHome(config: Record<string, unknown>): string {
  const envConfig = parseObject(config.env);
  const configuredHome =
    typeof envConfig.HOME === "string" && envConfig.HOME.trim().length > 0
      ? path.resolve(envConfig.HOME.trim())
      : os.homedir();
  return path.join(configuredHome, ".antigravity", "skills");
}

/**
 * Antigravity remote managed-home seed for the runner-backed remote sandbox ACP lane.
 * Mirrors the Antigravity CLI lane (`antigravity-local/execute.ts`): set `HOME` to the
 * managed runtime root, ship the prepared skills dir as the `skills` asset,
 * `cp -a` it into `$HOME/.antigravity/skills` in-sandbox, and — only when an API key
 * is present — pre-select the api-key auth in `$HOME/.antigravity/settings.json`
 * (Antigravity refuses headless runs without a persisted auth selection).
 *
 * The seed never writes key bytes: the key is only read as a boolean signal to
 * decide whether to persist the auth-method selector. Antigravity has no credential
 * copy-back. The teardown hook therefore only syncs the sandbox workspace back to
 * the host; it does not touch credentials.
 */
async function prepareAntigravityRemoteManagedHome(
  input: AcpxRemoteManagedHomeContext,
): Promise<AcpxRemoteManagedHomeResult> {
  const { env, runId, onLog, executionTarget } = input;
  // Fail-open workspace sync-back for every exit path (mirrors the Antigravity CLI
  // lane's restore-hook finally and the Codex ACP seam's teardown). Antigravity has no
  // credential copy-back, so the teardown only syncs the sandbox workspace back to
  // the host. A restore miss is logged and never fails the run.
  const registerWorkspaceSyncBack = (
    stagedRuntime: AcpxRemoteManagedHomeResult["stagedRuntime"],
  ): AcpxRemoteManagedHomeResult["teardown"] => async () => {
    try {
      await onLog("stdout", "[paperclip] Restoring workspace changes from the sandbox.\n");
      await stagedRuntime.restoreWorkspace((line) => onLog("stdout", line));
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip] Antigravity ACP teardown workspace restore failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  };
  const antigravitySkillsHome = resolveAntigravitySkillsHome(input.config);
  const stagedRuntime = await input.stage(
    antigravitySkillsHome
      ? [{ key: "skills", localDir: antigravitySkillsHome, followSymlinks: true }]
      : [],
  );

  // Managed HOME = the per-run runtime root. `useRemoteProcessSession` already
  // guarantees a sandbox (managed-home) target, so the runtime root replaces the
  // image home for this run.
  const managedRemoteHomeDir = stagedRuntime.runtimeRootDir;
  if (!managedRemoteHomeDir) {
    // No runtime root resolved — leave HOME as-is (host fallback) and skip the
    // in-sandbox seed; nothing to remap onto. The workspace still staged, so the
    // sync-back teardown still applies.
    return { stagedRuntime, teardown: registerWorkspaceSyncBack(stagedRuntime) };
  }
  env.HOME = managedRemoteHomeDir;

  const shellOptions = {
    cwd: stagedRuntime.workspaceRemoteDir ?? input.workspaceLocalDir,
    env,
    timeoutSec: Math.max(input.timeoutSec, 15),
    graceSec: 20,
    onLog,
  };

  // Copy the shipped skills into $HOME/.antigravity/skills so the CLI finds them under
  // the managed home.
  const remoteSkillsAssetDir = stagedRuntime.assetDirs.skills;
  if (remoteSkillsAssetDir) {
    const remoteSkillsDir = path.posix.join(managedRemoteHomeDir, ".antigravity", "skills");
    await runAdapterExecutionTargetShellCommand(
      runId,
      executionTarget,
      `mkdir -p ${JSON.stringify(path.posix.dirname(remoteSkillsDir))} && rm -rf ${JSON.stringify(remoteSkillsDir)} && cp -a ${JSON.stringify(remoteSkillsAssetDir)} ${JSON.stringify(remoteSkillsDir)}`,
      shellOptions,
    );
  }

  // Pre-select api-key auth (file-only; no key bytes) so headless Antigravity does not
  // fail with "Invalid auth method selected". Only the credential's PRESENCE is
  // used as a signal — no key bytes are written to settings.json.
  //
  // The presence check reads ONLY the resolved run `env` — the credential state
  // this seam actually provisions into the sandbox (adapter-config env + resolved
  // secret refs, repointed onto the in-sandbox HOME). A key that exists only in
  // the host `process.env` is NOT a reliable signal: the remote sandbox does not
  // inherit the host environment, so persisting a `antigravity-api-key` selector off a
  // host-only key would start headless Antigravity with an auth method whose credential
  // is unavailable in-sandbox and fail authentication. We therefore select api-key
  // auth only when the key is present in the run env that reaches the sandbox. An
  // existing settings.json (user-shipped via workspace) is left untouched.
  const hasAntigravityApiKey = Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
  if (hasAntigravityApiKey) {
    const remoteSettingsPath = path.posix.join(managedRemoteHomeDir, ".antigravity", "settings.json");
    const authSettingsJson = JSON.stringify({
      selectedAuthType: "antigravity-api-key",
      security: { auth: { selectedType: "antigravity-api-key" } },
    });
    await runAdapterExecutionTargetShellCommand(
      runId,
      executionTarget,
      `mkdir -p ${JSON.stringify(path.posix.dirname(remoteSettingsPath))} && { [ -f ${JSON.stringify(remoteSettingsPath)} ] || printf '%s' ${JSON.stringify(authSettingsJson)} > ${JSON.stringify(remoteSettingsPath)}; }`,
      shellOptions,
    );
  }

  return { stagedRuntime, teardown: registerWorkspaceSyncBack(stagedRuntime) };
}

function withAntigravityAcpDefaults(options: AntigravityAcpExecutorOptions): AcpxEngineExecutorOptions {
  return {
    prepareRemoteManagedHome: prepareAntigravityRemoteManagedHome,
    ...options,
    adapterType: "antigravity_local",
    moduleDir,
    packageRootDir,
  };
}

export function createAntigravityAcpExecutor(options: AntigravityAcpExecutorOptions = {}): AntigravityAcpExecutor {
  let executor: AntigravityAcpExecutor | null = null;
  return async (ctx) => {
    let currentExecutor = executor;
    if (!currentExecutor) {
      const { createAcpxEngineExecutor } = await import("@paperclipai/adapter-utils/acpx-engine/execute");
      currentExecutor = createAcpxEngineExecutor(withAntigravityAcpDefaults(options));
      executor = currentExecutor;
    }
    return currentExecutor({
      ...ctx,
      config: buildAntigravityAcpConfig(ctx.config),
    });
  };
}

function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function nodeVersionMeetsAntigravityAcpMinimum(version = process.version): boolean {
  const [major, minor, patch] = parseVersion(version);
  const [minMajor, minMinor, minPatch] = parseVersion(MIN_ACP_NODE_VERSION);
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function firstShellToken(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("'") || trimmed.startsWith("\"")) return null;
  return trimmed.split(/\s+/, 1)[0] ?? null;
}

async function findCommandOnPath(binName: string, pathValue = process.env.PATH ?? ""): Promise<string | null> {
  for (const segment of pathValue.split(path.delimiter)) {
    if (!segment) continue;
    const candidate = path.join(segment, binName);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function resolveConfigPath(config: Record<string, unknown>): string {
  const envConfig = parseObject(config.env);
  return typeof envConfig.PATH === "string" && envConfig.PATH.trim().length > 0
    ? envConfig.PATH
    : process.env.PATH ?? "";
}

async function commandIsResolvable(
  command: string,
  pathValue = process.env.PATH ?? "",
  input?: AntigravityEngineResolutionInput,
): Promise<boolean> {
  const token = firstShellToken(command);
  if (!token) return true;
  const target = readAdapterExecutionTarget({
    executionTarget: input?.executionTarget,
    legacyRemoteExecution: input?.executionTransport?.remoteExecution,
  });
  if (target?.kind === "remote") {
    try {
      await ensureAdapterExecutionTargetCommandResolvable(
        token,
        target,
        resolveAdapterExecutionTargetCwd(target, asString(input?.config.cwd, ""), process.cwd()),
        process.env,
      );
      return true;
    } catch {
      return false;
    }
  }
  if (path.isAbsolute(token) || hasPathSeparator(token)) return pathExists(token);
  return (await findCommandOnPath(token, pathValue)) !== null;
}

function resolveAntigravityAcpCommand(config: Record<string, unknown>): string {
  const configured = firstNonEmptyString(config.agentCommand, config.acpAgentCommand);
  if (configured) return configured;
  const antigravityCommand = firstNonEmptyString(config.command) ?? "antigravity";
  return `${antigravityCommand} --acp`;
}

function sandboxTargetHasProcessSessionBridge(
  target: ReturnType<typeof readAdapterExecutionTarget>,
): boolean {
  return target?.kind === "remote" && target.transport === "sandbox" && Boolean(target.runner);
}

async function defaultAntigravityAcpFallbackReason(
  input: AntigravityEngineResolutionInput,
): Promise<string | null> {
  const target = readAdapterExecutionTarget({
    executionTarget: input.executionTarget,
    legacyRemoteExecution: input.executionTransport?.remoteExecution,
  });
  if (target?.kind === "remote" && !sandboxTargetHasProcessSessionBridge(target)) {
    if (target.transport === "sandbox") {
      return "Antigravity ACP requires a bidirectional remote process target; this sandbox exposes only one-shot command execution.";
    }
    return "Antigravity ACP supports sandbox remote targets only; this run targets a non-sandbox remote environment.";
  }
  if (!nodeVersionMeetsAntigravityAcpMinimum()) {
    return `Node ${process.version} does not satisfy Antigravity ACP's Node >=${MIN_ACP_NODE_VERSION} prerequisite.`;
  }
  const command = resolveAntigravityAcpCommand(input.config);
  if (!(await commandIsResolvable(command, resolveConfigPath(input.config), input))) {
    return `Antigravity ACP command is not available: ${command}.`;
  }
  return null;
}

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function testAntigravityAcpEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";

  checks.push({
    code: "antigravity_engine_selected",
    level: "info",
    message: "Execution engine selected: ACP.",
    hint: "Set engine=cli to use the existing Antigravity CLI lane.",
  });

  if (targetIsRemote) {
    checks.push({
      code: "antigravity_acp_remote_target",
      level: "info",
      message: "Antigravity ACP will run against the remote execution environment.",
      hint: "Remote ACP requires a bidirectional process target such as SSH or Paperclip's sandbox process-session bridge.",
    });
  }

  const cwd = asString(config.cwd, process.cwd());
  try {
    await fs.mkdir(cwd, { recursive: true });
    checks.push({
      code: "antigravity_acp_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "antigravity_acp_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  checks.push({
    code: nodeVersionMeetsAntigravityAcpMinimum() ? "antigravity_acp_node_supported" : "antigravity_acp_node_unsupported",
    level: nodeVersionMeetsAntigravityAcpMinimum() ? "info" : "error",
    message: nodeVersionMeetsAntigravityAcpMinimum()
      ? `Node ${process.version} satisfies ACP runtime requirements.`
      : `Node ${process.version} does not satisfy ACP runtime requirements.`,
    hint: nodeVersionMeetsAntigravityAcpMinimum()
      ? undefined
      : `Run Antigravity ACP with Node >=${MIN_ACP_NODE_VERSION} or switch engine=cli.`,
  });

  const command = resolveAntigravityAcpCommand(config);
  const commandResolvable = await commandIsResolvable(command, resolveConfigPath(config), {
    config,
    executionTarget: ctx.executionTarget,
  });
  checks.push({
    code: commandResolvable ? "antigravity_acp_command_resolvable" : "antigravity_acp_command_missing",
    level: commandResolvable ? "info" : "error",
    message: commandResolvable
      ? `Antigravity ACP command is executable: ${command}`
      : `Antigravity ACP command is not available: ${command}`,
    hint: commandResolvable
      ? undefined
      : "Install the Antigravity CLI with ACP support, or set agentCommand to a valid Antigravity ACP server command.",
  });

  const envConfig = parseObject(config.env);
  const considerHostEnv = !targetIsRemote;
  const hasGca = envConfig.GOOGLE_GENAI_USE_GCA === "true" || (considerHostEnv && process.env.GOOGLE_GENAI_USE_GCA === "true");
  const configAntigravityApiKey = envConfig.GEMINI_API_KEY;
  const hostAntigravityApiKey = considerHostEnv ? process.env.GEMINI_API_KEY : undefined;
  const configGoogleApiKey = envConfig.GOOGLE_API_KEY;
  const hostGoogleApiKey = considerHostEnv ? process.env.GOOGLE_API_KEY : undefined;
  if (
    isNonEmpty(configAntigravityApiKey) ||
    isNonEmpty(hostAntigravityApiKey) ||
    isNonEmpty(configGoogleApiKey) ||
    isNonEmpty(hostGoogleApiKey) ||
    hasGca
  ) {
    const source = hasGca
      ? "Google account login (GCA)"
      : isNonEmpty(configAntigravityApiKey) || isNonEmpty(configGoogleApiKey)
        ? "adapter config env"
        : "server environment";
    checks.push({
      code: "antigravity_acp_credentials_detected",
      level: "info",
      message: "Antigravity credentials are set for ACP authentication.",
      detail: `Detected in ${source}.`,
    });
  } else if (!targetIsRemote) {
    checks.push({
      code: "antigravity_acp_credentials_not_detected",
      level: "warn",
      message: "No Antigravity ACP credentials were detected.",
      hint: "Set GEMINI_API_KEY / GOOGLE_API_KEY, enable Google account auth, or run `agy login` before starting a Antigravity ACP agent.",
    });
  }

  const mode = firstNonEmptyString(config.mode, config.acpMode) ?? DEFAULT_ACP_ENGINE_MODE;
  const warmHandleIdleMs = asNumber(
    config.warmHandleIdleMs ?? config.acpWarmHandleIdleMs,
    DEFAULT_ACP_ENGINE_WARM_HANDLE_IDLE_MS,
  );
  checks.push({
    code: "antigravity_acp_runtime_scaffold",
    level: "info",
    message: "Antigravity ACP runtime execution is available through the shared ACP engine.",
    detail: `mode=${mode}; warmHandleIdleMs=${warmHandleIdleMs}`,
  });

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
