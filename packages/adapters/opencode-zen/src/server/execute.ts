import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { execute as opencodeExecute } from "@paperclipai/adapter-opencode-local/server";
import {
  DEFAULT_GATEWAY_PROVIDER_ID,
  DEFAULT_MODEL_ID,
} from "../index.js";

function buildGatewayProvidersJson(
  gatewayUrl: string,
  gatewayKey: string,
): string {
  return JSON.stringify({
    [DEFAULT_GATEWAY_PROVIDER_ID]: {
      npm: "@ai-sdk/openai-compatible",
      name: "AI Gateway (RoozyLabs)",
      options: {
        baseURL: gatewayUrl,
        apiKey: gatewayKey,
      },
      models: {
        [DEFAULT_MODEL_ID]: {
          name: "Big Pickle",
        },
      },
    },
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = parseObject(ctx.config);

  const envGatewayUrl = process.env.PAPERCLIP_OPENCODE_ZEN_GATEWAY_URL?.trim() ?? "";
  const envGatewayKey = process.env.PAPERCLIP_OPENCODE_ZEN_API_KEY?.trim() ?? "";

  const gatewayUrl = asString(config.gatewayUrl, envGatewayUrl);
  const gatewayKey = asString(config.gatewayApiKey, envGatewayKey);

  if (gatewayUrl && gatewayKey) {
    const existingEnv = parseObject(config.env);
    config.env = {
      ...existingEnv,
      PAPERCLIP_OPENCODE_PROVIDERS: buildGatewayProvidersJson(gatewayUrl, gatewayKey),
    };
  }

  return opencodeExecute({ ...ctx, config });
}
