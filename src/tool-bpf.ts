import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { pickLegacyTools, type ToolFactoryParams } from "./tool-factories.js";

const BPF_TOOL_NAMES = [
  "clawwrt_bpf_add",
  "clawwrt_bpf_json",
  "clawwrt_get_l7_active_stats",
  "clawwrt_get_l7_protocol_catalog",
  "clawwrt_bpf_del",
  "clawwrt_bpf_flush",
  "clawwrt_bpf_update",
  "clawwrt_bpf_update_all",
] as const;

export function createBpfTools(params: ToolFactoryParams): AnyAgentTool[] {
  return pickLegacyTools(params, BPF_TOOL_NAMES);
}
