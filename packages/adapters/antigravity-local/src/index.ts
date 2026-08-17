import {
  type AdapterModelProfileDefinition,
} from "@paperclipai/adapter-utils";

export const type = "antigravity_local";
export const label = "Antigravity CLI";

export const capabilities = {
  supportsInstructionsBundle: true,
  supportsSkills: true,
  supportsLocalAgentJwt: true,
  requiresMaterializedRuntimeSkills: true,
  supportsModelProfiles: true,
  supportsAcp: true,
};

export const DEFAULT_ANTIGRAVITY_LOCAL_MODEL = "auto";

export const models = [
  { id: DEFAULT_ANTIGRAVITY_LOCAL_MODEL, label: "Auto" },
  { id: "gemini-3.7-pro", label: "Gemini 3.7 Pro" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Use Gemini Flash Lite as the budget Antigravity CLI lane while preserving the primary model.",
    adapterConfig: {
      model: "gemini-2.5-flash-lite",
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# antigravity_local agent configuration

Adapter: antigravity_local

Use when:
- You want Paperclip to run Google's Antigravity CLI (\`agy\`) locally on the host machine
- You want Antigravity chat sessions resumed across heartbeats with --resume
- You want Paperclip skills injected locally into ~/.gemini/skills/ or ~/.antigravity/skills/ without polluting the project directory

Don't use when:
- You need webhook-style external invocation (use http or openclaw_gateway)
- You only need a one-shot script without an AI coding agent loop (use process)
- Antigravity CLI is not installed on the machine that runs Paperclip

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- promptTemplate (string, optional): run prompt template
- model (string, optional): model id. Defaults to auto.
- command (string, optional): defaults to "agy"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs use non-interactive prompt execution.
- The adapter sets a headless-safe terminal environment for Antigravity CLI child processes so unattended runs do not block.
- Sessions resume with --resume when stored session cwd matches the current cwd.
- Paperclip auto-injects local skills into \`~/.gemini/skills/\` and \`~/.antigravity/skills/\` via symlinks, so the CLI discovers skills in their natural locations.
- Authentication uses GEMINI_API_KEY / GOOGLE_API_KEY or local Antigravity CLI login credentials.
`;
