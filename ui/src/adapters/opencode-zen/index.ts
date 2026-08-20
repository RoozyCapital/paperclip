import type { UIAdapterModule } from "../types";
import { parseOpenCodeStdoutLine } from "@paperclipai/adapter-opencode-local/ui";
import { OpenCodeZenConfigFields } from "./config-fields";
import { buildOpenCodeZenConfig } from "@paperclipai/adapter-opencode-zen/ui";

export const openCodeZenUIAdapter: UIAdapterModule = {
  type: "opencode_zen",
  label: "OpenCode Zen (Gateway)",
  parseStdoutLine: parseOpenCodeStdoutLine,
  ConfigFields: OpenCodeZenConfigFields,
  buildAdapterConfig: buildOpenCodeZenConfig,
};
