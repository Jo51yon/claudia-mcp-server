/**
 * Real, declarative tool definitions loaded from a JSON file -- the "point to more advanced
 * configs" part of the request. Each tool maps directly to one Postgres RPC call, matching the
 * exact real pattern already proven in petgi-mcp/lintel-mcp's own TOOLS[] arrays (rpc + an
 * argument mapping) -- generalised into pure JSON here since a compiled binary can't accept an
 * arbitrary TypeScript function as config.
 *
 * argsMap is a simple rename: each entry maps an MCP-tool-call argument name to the real
 * Postgres RPC parameter name it should be passed as (e.g. {"query": "p_query"}). A
 * project-specific fixed value (not something the caller supplies) can be set via
 * fixedArgs -- e.g. binding p_project_slug to this deployment's own project without the
 * caller ever needing to pass it or being able to override it.
 */
export interface ClaudiaMcpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  rpc: string;
  argsMap?: Record<string, string>;
  fixedArgs?: Record<string, unknown>;
}

export async function loadTools(path: string): Promise<ClaudiaMcpToolDef[]> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (e) {
    throw new Error(`Could not read tools file at ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Tools file at ${path} must be a JSON array`);
  for (const t of parsed) {
    if (!t.name || !t.rpc || !t.inputSchema) {
      throw new Error(`Invalid tool definition in ${path}: every entry needs name, rpc, and inputSchema. Got: ${JSON.stringify(t)}`);
    }
  }
  return parsed as ClaudiaMcpToolDef[];
}

/** Builds the real RPC argument object for a tool call, applying argsMap then fixedArgs. */
export function buildRpcArgs(tool: ClaudiaMcpToolDef, callArgs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [callKey, rpcKey] of Object.entries(tool.argsMap ?? {})) {
    result[rpcKey] = callArgs[callKey] ?? null;
  }
  return { ...result, ...(tool.fixedArgs ?? {}) };
}
