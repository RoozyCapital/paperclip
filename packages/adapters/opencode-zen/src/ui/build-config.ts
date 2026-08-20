import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { buildOpenCodeLocalConfig } from "@paperclipai/adapter-opencode-local/ui";
import { DEFAULT_GATEWAY_PROVIDER_ID, DEFAULT_MODEL_ID } from "../index.js";

export function buildOpenCodeZenConfig(v: CreateConfigValues): Record<string, unknown> {
  const base = buildOpenCodeLocalConfig(v);

  if (!base.model) {
    base.model = `${DEFAULT_GATEWAY_PROVIDER_ID}/${DEFAULT_MODEL_ID}`;
  }

  const schemaValues = (v.adapterSchemaValues as Record<string, unknown>) ?? {};
  if (schemaValues.gatewayUrl) base.gatewayUrl = schemaValues.gatewayUrl;
  if (schemaValues.gatewayApiKey) base.gatewayApiKey = schemaValues.gatewayApiKey;

  return base;
}
