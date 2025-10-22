import { logInfo, logError } from "@/main/utils/logger";
import { MCPServerConfig } from "@mcp_router/shared";
import { processDxtFile } from "@/main/modules/mcp-server-manager/dxt-processor/dxt-processor";

/**
 * Detect bundle type by filename or file content.
 * - dxt: .dxt extension, or binary/zip (PK header)
 * - mcpb-json: .mcpb extension or JSON content
 */
function detectBundleType(file: Uint8Array, fileName?: string): "dxt" | "mcpb-json" {
  const name = (fileName || "").toLowerCase();
  if (name.endsWith(".dxt")) return "dxt";
  if (name.endsWith(".mcpb")) return "mcpb-json";

  // Peek first few bytes to detect JSON or ZIP
  const maxPeek = Math.min(64, file.length);
  const peek = Buffer.from(file.slice(0, maxPeek));
  const text = peek.toString("utf8");
  const trimmed = text.trimStart();

  // ZIP files start with PK\x03\x04 typically
  const isZip = peek[0] === 0x50 && peek[1] === 0x4b; // 'PK'
  if (isZip) return "dxt";

  // JSON likely starts with '{' after whitespace
  if (trimmed.startsWith("{")) return "mcpb-json";

  // Default to dxt to reuse robust unpacker
  return "dxt";
}

/**
 * Process MCPB JSON bundle into MCPServerConfig.
 * Assumes the file is a JSON-encoded MCPServerConfig or a wrapper { server: MCPServerConfig }.
 */
async function processMcpbJson(file: Uint8Array): Promise<MCPServerConfig> {
  try {
    const jsonStr = Buffer.from(file).toString("utf8");
    const parsed = JSON.parse(jsonStr);

    const config: MCPServerConfig = parsed.server ? parsed.server : parsed;

    // Minimal validation
    if (!config || typeof config !== "object") {
      throw new Error("Invalid MCPB content: not an object");
    }
    if (!config.name) {
      throw new Error("Invalid MCPB: missing 'name'");
    }
    if (!config.serverType) {
      // Default to local if not specified
      (config as any).serverType = "local";
    }
    if (!config.env) {
      config.env = {};
    }

    // Ensure optional fields exist for consistency
    config.disabled = config.disabled ?? false;
    config.autoStart = config.autoStart ?? false;
    config.verificationStatus = config.verificationStatus ?? "unverified";

    return config;
  } catch (err: any) {
    logError("MCPB JSON parse failed: " + (err?.message || String(err)));
    throw err;
  }
}

/**
 * Unified bundle processor: accepts DXT or MCPB and returns MCPServerConfig.
 */
export async function processBundleFile(
  file: Uint8Array,
  fileName?: string,
): Promise<MCPServerConfig> {
  const type = detectBundleType(file, fileName);
  logInfo(`BundleProcessor: detected type '${type}' for '${fileName || "binary"}'`);
  if (type === "dxt") {
    return processDxtFile(file);
  }
  return processMcpbJson(file);
}