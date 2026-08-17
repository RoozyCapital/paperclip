import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  overrideAdapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetTimeoutSec,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildPaperclipEnv,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensurePaperclipSkillSymlink,
  joinPromptSections,
  ensurePathInEnv,
  refreshPaperclipWorkspaceEnvForExecution,
  readPaperclipRuntimeSkillEntries,
  readPaperclipIssueWorkModeFromContext,
  resolvePaperclipDesiredSkillNames,
  parseObject,
  renderTemplate,
  renderPaperclipWakePrompt,
  isPaperclipRecoveryWakePayload,
  stringifyPaperclipWakePayload,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_ANTIGRAVITY_LOCAL_MODEL } from "../index.js";
import {
  describeAntigravityFailure,
  detectAntigravityAuthRequired,
  isAntigravityTransientNetworkError,
  isAntigravityTurnLimitResult,
  isAntigravitySessionUnrecoverableError,
  parseAntigravityJsonl,
} from "./parse.js";
import { firstNonEmptyLine } from "./utils.js";
import { resolveAntigravitySkillsHomes } from "./skills.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function buildAntigravityHeadlessEnv(env: Record<string, string>): Record<string, string> {
  const next = { ...env };
  const term = env.TERM?.trim().toLowerCase();
  if (!term || term === "dumb" || term === "vt100") {
    next.TERM = "xterm-256color";
  }
  if (!next.COLORTERM?.trim()) {
    next.COLORTERM = "truecolor";
  }
  next.NO_BROWSER = "1";
  delete next.NO_COLOR;
  return next;
}

function buildAntigravityRuntimeEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ensurePathInEnv({ ...process.env, ...buildAntigravityHeadlessEnv(env) })).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function renderPaperclipEnvNote(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${paperclipKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
    "",
    "",
  ].join("\n");
}

function renderApiAccessNote(env: Record<string, string>): string {
  if (!hasNonEmptyEnvValue(env, "PAPERCLIP_API_URL") || !hasNonEmptyEnvValue(env, "PAPERCLIP_API_KEY")) return "";
  return [
    "Paperclip API access note:",
    "Use shell commands with curl to make Paperclip API requests.",
    "GET example:",
    `  curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/agents/me"`,
    "POST/PATCH example:",
    `  curl -s -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H 'Content-Type: application/json' -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -d '{...}' "$PAPERCLIP_API_URL/api/issues/{id}/checkout"`,
    "",
    "",
  ].join("\n");
}

async function ensureAntigravitySkillsInjected(
  onLog: AdapterExecutionContext["onLog"],
  skillsEntries: Array<{ key: string; runtimeName: string; source: string }>,
  desiredSkillNames?: string[],
  config: Record<string, unknown> = {},
): Promise<void> {
  const desiredSet = new Set(desiredSkillNames ?? skillsEntries.map((entry) => entry.key));
  const selectedEntries = skillsEntries.filter((entry) => desiredSet.has(entry.key));
  if (selectedEntries.length === 0) return;

  const skillsHomes = resolveAntigravitySkillsHomes(config);
  for (const skillsHome of skillsHomes) {
    try {
      await fs.mkdir(skillsHome, { recursive: true });
      for (const entry of selectedEntries) {
        const target = path.join(skillsHome, entry.runtimeName);
        await ensurePaperclipSkillSymlink(entry.source, target);
      }
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip:antigravity_local] warning: failed to link skills into ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

import {
  createAntigravityAcpExecutor,
  resolveAntigravityExecutionEngineForRun,
} from "./acp.js";

const executeAntigravityAcp = createAntigravityAcpExecutor();

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const engineSelection = await resolveAntigravityExecutionEngineForRun({
    config: parseObject(ctx.config),
    executionTarget: ctx.executionTarget,
    executionTransport: ctx.executionTransport,
  });
  if (engineSelection.engine === "acp") {
    return await executeAntigravityAcp(ctx);
  }

  const { runId, agent, runtime, config, context, onLog, onMeta, authToken } = ctx;

  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const targetIsRemote = adapterExecutionTargetIsRemote(executionTarget);
  const targetCwd = adapterExecutionTargetRemoteCwd(executionTarget, "");

  const command = asString(config.command, "agy");
  const model = asString(config.model, DEFAULT_ANTIGRAVITY_LOCAL_MODEL).trim();
  const configuredCwd = asString(config.cwd, "");
  const effectiveCwd = targetCwd || configuredCwd || process.cwd();
  const cwd = effectiveCwd;
  if (!targetIsRemote) {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
  }

  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(executionTarget, asNumber(config.timeoutSec, 0));
  const graceSec = Math.max(1, asNumber(config.graceSec, 15));

  const extraArgs = asStringArray(config.extraArgs);
  const customEnv: Record<string, string> = {};
  const rawEnv = parseObject(config.env);
  for (const [k, v] of Object.entries(rawEnv)) {
    if (typeof v === "string") customEnv[k] = v;
  }

  const paperclipEnv = buildPaperclipEnv(agent);
  paperclipEnv.PAPERCLIP_RUN_ID = runId;
  if (authToken) paperclipEnv.PAPERCLIP_API_KEY = authToken;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);
  if (wakeTaskId) paperclipEnv.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) paperclipEnv.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) paperclipEnv.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) paperclipEnv.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) paperclipEnv.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) paperclipEnv.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) paperclipEnv.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (wakePayloadJson) paperclipEnv.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];

  refreshPaperclipWorkspaceEnvForExecution({
    env: paperclipEnv,
    envConfig: customEnv,
    workspaceCwd,
    workspaceSource,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceHints,
    agentHome,
    executionTargetIsRemote: targetIsRemote,
    executionCwd: cwd,
  });

  const runEnv: Record<string, string> = {
    ...customEnv,
    ...paperclipEnv,
  };

  const availableSkillEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkillNames = resolvePaperclipDesiredSkillNames(config, availableSkillEntries);

  if (!targetIsRemote) {
    await ensureAntigravitySkillsInjected(onLog, availableSkillEntries, desiredSkillNames, config);
  }

  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const issueWakePrompt = renderPaperclipWakePrompt(context);

  let instructions = "";
  const instructionsFilePath = asString(config.instructionsFilePath, "");
  if (instructionsFilePath) {
    try {
      instructions = await fs.readFile(instructionsFilePath, "utf8");
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip:antigravity_local] warning: failed to read instructions file ${instructionsFilePath}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const renderedTemplate = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    agent,
    context,
  });

  const prompt = joinPromptSections([
    renderPaperclipEnvNote(runEnv),
    renderApiAccessNote(runEnv),
    instructions,
    renderedTemplate,
    issueWakePrompt,
  ]);

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, asString(runtime.sessionId, ""));
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const runtimeTargetIdentity = adapterExecutionTargetSessionIdentity(executionTarget);
  const targetMatchesSession = adapterExecutionTargetSessionMatches(
    runtimeSessionParams.executionTarget,
    executionTarget,
  );

  const canResume =
    Boolean(runtimeSessionId) &&
    targetMatchesSession &&
    (!runtimeSessionCwd || path.resolve(runtimeSessionCwd) === path.resolve(cwd));

  const initialSessionId = canResume ? runtimeSessionId : null;

  async function runAttempt(sessionToResume: string | null) {
    const args: string[] = ["--prompt", prompt];

    if (model && model !== DEFAULT_ANTIGRAVITY_LOCAL_MODEL) {
      args.push("--model", model);
    }

    if (sessionToResume) {
      args.push("--resume", sessionToResume);
    }

    if (extraArgs.length > 0) {
      args.push(...extraArgs);
    }

    if (onMeta) {
      const commandForLogs = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runEnv);
      await onMeta({
        adapterType: "antigravity_local",
        command: commandForLogs,
        commandArgs: args,
        cwd,
        env: buildInvocationEnvForLogs(runEnv),
      });
    }

    return runAdapterExecutionTargetProcess(
      runId,
      executionTarget,
      command,
      args,
      {
        cwd,
        env: runEnv,
        timeoutSec,
        graceSec,
        onLog,
      },
    );
  }

  let attempt = await runAttempt(initialSessionId);
  let parsed = parseAntigravityJsonl(attempt.stdout);

  if (
    initialSessionId &&
    !attempt.timedOut &&
    attempt.exitCode !== 0 &&
    isAntigravitySessionUnrecoverableError(attempt.stdout, attempt.stderr)
  ) {
    await onLog(
      "stderr",
      `[paperclip:antigravity_local] session ${initialSessionId} unrecoverable, retrying with fresh session...\n`,
    );
    attempt = await runAttempt(null);
    parsed = parseAntigravityJsonl(attempt.stdout);
  }

  const effectiveSessionId = parsed.sessionId || initialSessionId;
  const sessionParams: Record<string, unknown> | null = effectiveSessionId
    ? {
        sessionId: effectiveSessionId,
        cwd,
        ...(runtimeTargetIdentity ? { executionTarget: runtimeTargetIdentity } : {}),
      }
    : null;

  const errorMessage =
    attempt.timedOut
      ? `Antigravity CLI timed out after ${timeoutSec}s`
      : attempt.exitCode !== 0
        ? parsed.errorMessage || describeAntigravityFailure(parsed.resultEvent ?? {}) || firstNonEmptyLine(attempt.stderr) || `Antigravity CLI failed with exit code ${attempt.exitCode}`
        : null;

  return {
    exitCode: attempt.exitCode,
    signal: attempt.signal,
    timedOut: attempt.timedOut,
    errorMessage,
    usage: parsed.usage,
    costUsd: parsed.costUsd,
    sessionId: effectiveSessionId,
    sessionParams,
    sessionDisplayId: effectiveSessionId,
    summary: parsed.summary,
    resultJson: parsed.resultEvent,
    provider: "google",
    model: model === DEFAULT_ANTIGRAVITY_LOCAL_MODEL ? undefined : model,
  };
}
