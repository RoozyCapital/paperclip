import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "opencode_zen";
export const label = "OpenCode Zen (Gateway)";

export const DEFAULT_GATEWAY_PROVIDER_ID = "roozylabs-ai-gateway";
export const DEFAULT_MODEL_ID = "big-pickle";

export const models: Array<{ id: string; label: string }> = [
  { id: `${DEFAULT_GATEWAY_PROVIDER_ID}/${DEFAULT_MODEL_ID}`, label: "Big Pickle" },
];

export const DEFAULT_MODEL_PROFILES: AdapterModelProfileDefinition[] = [];

export const agentConfigurationDoc = `# opencode_zen agent configuration

Adapter: opencode_zen

Use when:
- You want Paperclip to run OpenCode routed through a custom AI gateway
- The gateway exposes an OpenAI-compatible /v1/chat/completions endpoint
- You want centralized credential management via gateway API keys

Don't use when:
- You need direct provider access without a gateway (use opencode_local)
- The gateway does not expose an OpenAI-compatible API
- You need webhook-style external invocation (use openclaw_gateway or http)

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- model (string, required): model id in provider/model format (for example roozylabs-ai-gateway/big-pickle)
- variant (string, optional): provider-specific reasoning/profile variant
- dangerouslySkipPermissions (boolean, optional): inject a runtime OpenCode config that allows external_directory access without interactive prompts; defaults to true
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "opencode"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Gateway fields:
- gatewayUrl (string, optional): override gateway URL (defaults to PAPERCLIP_OPENCODE_ZEN_GATEWAY_URL env var)
- gatewayApiKey (string, optional): override gateway API key (defaults to PAPERCLIP_OPENCODE_ZEN_API_KEY env var)

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Environment variables:
- PAPERCLIP_OPENCODE_ZEN_GATEWAY_URL: gateway base URL (e.g. http://43.163.100.49:8080/v1)
- PAPERCLIP_OPENCODE_ZEN_API_KEY: gateway API key (gw_sk_...)

Notes:
- This adapter wraps opencode_local with pre-configured gateway routing
- The gateway provider is injected via PAPERCLIP_OPENCODE_PROVIDERS at runtime
- Model selection uses provider/model format (e.g. roozylabs-ai-gateway/big-pickle)
`;
