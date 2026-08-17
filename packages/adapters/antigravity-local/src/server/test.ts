import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  ensurePathInEnv,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
} from "@paperclipai/adapter-utils/execution-target";
import { DEFAULT_ANTIGRAVITY_LOCAL_MODEL } from "../index.js";
import { detectAntigravityAuthRequired, detectAntigravityQuotaExhausted, parseAntigravityJsonl } from "./parse.js";
import { firstNonEmptyLine } from "./utils.js";

import {
  resolveAntigravityExecutionEngineForRun,
  testAntigravityAcpEnvironment,
} from "./acp.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const engineSelection = await resolveAntigravityExecutionEngineForRun({
    config: parseObject(ctx.config),
    executionTarget: ctx.executionTarget,
  });
  if (engineSelection.engine === "acp") {
    return testAntigravityAcpEnvironment(ctx);
  }
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "agy");
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const targetLabel = targetIsRemote
    ? ctx.environmentName ?? describeAdapterExecutionTarget(target)
    : null;
  const runId = `antigravity-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: "antigravity_environment_target",
      level: "info",
      message: `Probing inside environment: ${targetLabel}`,
    });
  }

  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: true,
    });
    checks.push({
      code: "antigravity_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "antigravity_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv);
    checks.push({
      code: "antigravity_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "antigravity_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
      hint: "Make sure Antigravity CLI (`agy`) is installed and available in your PATH.",
    });
  }

  const configGeminiApiKey = env.GEMINI_API_KEY;
  const hostGeminiApiKey = targetIsRemote ? undefined : process.env.GEMINI_API_KEY;
  const configGoogleApiKey = env.GOOGLE_API_KEY;
  const hostGoogleApiKey = targetIsRemote ? undefined : process.env.GOOGLE_API_KEY;
  const hasAuth =
    isNonEmpty(configGeminiApiKey) ||
    isNonEmpty(hostGeminiApiKey) ||
    isNonEmpty(configGoogleApiKey) ||
    isNonEmpty(hostGoogleApiKey);

  if (hasAuth) {
    const source = isNonEmpty(configGeminiApiKey) || isNonEmpty(configGoogleApiKey)
      ? "adapter config env"
      : "server environment";
    checks.push({
      code: "antigravity_api_key_present",
      level: "info",
      message: "Antigravity/Gemini API credentials are set.",
      detail: `Detected in ${source}.`,
    });
  } else {
    checks.push({
      code: "antigravity_api_key_missing",
      level: "info",
      message: "No explicit API key detected. Antigravity CLI may authenticate via local login credentials.",
      hint: "If runs fail with an auth error, set GEMINI_API_KEY or GOOGLE_API_KEY in adapter env, or log in via `agy`.",
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "antigravity_cwd_invalid" && check.code !== "antigravity_command_unresolvable");

  if (canRunProbe && (commandLooksLike(command, "agy") || commandLooksLike(command, "gemini"))) {
    const model = asString(config.model, DEFAULT_ANTIGRAVITY_LOCAL_MODEL).trim();
    const helloProbeTimeoutSec = Math.max(1, asNumber(config.helloProbeTimeoutSec, 60));
    const extraArgs = asStringArray(config.extraArgs);

    const args = ["--prompt", "Respond with hello."];
    if (model && model !== DEFAULT_ANTIGRAVITY_LOCAL_MODEL) args.push("--model", model);
    if (extraArgs.length > 0) args.push(...extraArgs);

    try {
      const probe = await runAdapterExecutionTargetProcess(
        runId,
        target,
        command,
        args,
        {
          cwd,
          env,
          timeoutSec: helloProbeTimeoutSec,
          graceSec: 5,
          onLog: async () => {},
        },
      );
      const parsed = parseAntigravityJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
      const authMeta = detectAntigravityAuthRequired({
        parsed: parsed.resultEvent,
        stdout: probe.stdout,
        stderr: probe.stderr,
      });
      const quotaMeta = detectAntigravityQuotaExhausted({
        parsed: parsed.resultEvent,
        stdout: probe.stdout,
        stderr: probe.stderr,
      });

      if (quotaMeta.exhausted) {
        checks.push({
          code: "antigravity_hello_probe_quota_exhausted",
          level: "warn",
          message: "Antigravity CLI is configured, but the current account/key is over quota.",
          ...(detail ? { detail } : {}),
        });
      } else if (probe.timedOut) {
        checks.push({
          code: "antigravity_hello_probe_timed_out",
          level: "warn",
          message: "Antigravity hello probe timed out.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        checks.push({
          code: "antigravity_hello_probe_passed",
          level: "info",
          message: "Antigravity hello probe succeeded.",
        });
      } else if (authMeta.requiresAuth) {
        checks.push({
          code: "antigravity_hello_probe_auth_required",
          level: "warn",
          message: "Antigravity CLI is installed, but authentication is required.",
          ...(detail ? { detail } : {}),
          hint: "Authenticate with `agy` or set GEMINI_API_KEY/GOOGLE_API_KEY in adapter environment.",
        });
      } else {
        checks.push({
          code: "antigravity_hello_probe_completed",
          level: "info",
          message: `Antigravity CLI probe finished with exit code ${probe.exitCode ?? 0}.`,
          ...(detail ? { detail } : {}),
        });
      }
    } catch (probeErr) {
      // Non-fatal for preflight
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
