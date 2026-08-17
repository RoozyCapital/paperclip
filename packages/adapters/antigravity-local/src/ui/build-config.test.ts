import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { buildAntigravityLocalConfig } from "./build-config.js";

function makeValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    adapterType: "antigravity_local",
    cwd: "",
    instructionsFilePath: "",
    promptTemplate: "",
    model: "gemini-3.7-pro",
    thinkingEffort: "",
    chrome: false,
    dangerouslySkipPermissions: true,
    search: false,
    fastMode: false,
    dangerouslyBypassSandbox: false,
    command: "",
    args: "",
    extraArgs: "",
    envVars: "",
    envBindings: {},
    url: "",
    bootstrapPrompt: "",
    payloadTemplateJson: "",
    workspaceStrategyType: "project_primary",
    workspaceBaseRef: "",
    workspaceBranchTemplate: "",
    worktreeParentDir: "",
    runtimeServicesJson: "",
    maxTurnsPerRun: 1000,
    heartbeatEnabled: false,
    intervalSec: 300,
    ...overrides,
  };
}

describe("buildAntigravityLocalConfig", () => {
  it("builds basic configuration with default values", () => {
    const config = buildAntigravityLocalConfig(makeValues({
      command: "agy",
      model: "gemini-3.7-pro",
      cwd: "/workspace",
    }));

    expect(config).toMatchObject({
      command: "agy",
      model: "gemini-3.7-pro",
      cwd: "/workspace",
      timeoutSec: 0,
      graceSec: 15,
    });
  });

  it("handles extra args parsing correctly", () => {
    const config = buildAntigravityLocalConfig(makeValues({
      extraArgs: "--verbose, --debug",
    }));

    expect(config.extraArgs).toEqual(["--verbose", "--debug"]);
  });
});
