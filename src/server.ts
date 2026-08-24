import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { loadConfig, type ClaudiaMcpConfig } from './config.ts';
import { loadTools, buildRpcArgs, type ClaudiaMcpToolDef } from './tools.ts';

/**
 * ClaudiaMcpServer core -- extracted after checking the real, live petgi-mcp and lintel-mcp
 * (708 and 707 lines respectively; lintel-mcp's own header comment says it "mirrors petgi-mcp
 * exactly"). This is the shared skeleton those two files each independently carry: JSON-RPC
 * protocol handling (initialize, notifications/initialized, tools/list, tools/call), bearer
 * resolution against claudia-mcp-oauth, and the declarative rpc+args dispatch loop.
 *
 * Real, documented authorization model, preserved from the real source rather than
 * reinvented: the bearer resolves to a genuine Supabase user, and every tool call then runs
 * under that user's OWN real session (role=authenticated, request.jwt.claims set), so RLS
 * applies natively. No impersonation, no SECURITY DEFINER dispatcher.
 *
 * Deliberately NOT yet what petgi-mcp/lintel-mcp run in production -- this is a new, standalone,
 * config-driven build proving the shared-core + Debian-packaging concept end to end. Migrating
 * the live Edge Functions to consume this core is real, separate work, not done here: refactoring
 * a live, traffic-serving service in place without extensive additional testing would be reckless.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function rpcOk(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result }, { headers: CORS });
}
function rpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: CORS });
}
function unauthorized(config: ClaudiaMcpConfig): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${config.resourcePath}/.well-known/oauth-protected-resource"`,
    },
  });
}

export async function startServer(configPath?: string): Promise<void> {
  const config = await loadConfig(configPath);
  const tools = await loadTools(config.toolsFile);
  const admin: SupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  console.log(`claudia-mcp-server starting: project=${config.projectSlug} tools=${tools.length} port=${config.port}`);

  Deno.serve({ port: config.port }, async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
      return Response.json({ resource: config.resourcePath, authorization_servers: [config.authServer] }, { headers: CORS });
    }

    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!bearer) return unauthorized(config);

    const { data: whoData } = await admin.rpc(config.resolveBearerRpc, { p_token: bearer });
    const who = whoData as { user_id: string; email: string } | null;
    if (!who?.user_id || !who?.email) return unauthorized(config);

    let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return rpcError(null, -32700, 'Parse error');
    }

    const asUser = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });

    switch (body.method) {
      case 'initialize':
        return rpcOk(body.id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: `claudia-mcp-${config.projectSlug}`, version: '1.0.0' },
          capabilities: { tools: {} },
        });
      case 'notifications/initialized':
        return new Response(null, { status: 202, headers: CORS });
      case 'tools/list':
        return rpcOk(body.id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const name = body.params?.name as string | undefined;
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
        const tool = tools.find((t) => t.name === name);
        if (!tool) return rpcError(body.id, -32601, `Unknown tool: ${name}`);
        const { data, error } = await asUser.rpc(tool.rpc, buildRpcArgs(tool, args));
        if (error) return rpcError(body.id, -32000, error.message);
        return rpcOk(body.id, { content: [{ type: 'text', text: JSON.stringify(data) }] });
      }
      default:
        return rpcError(body.id, -32601, `Unknown method: ${body.method}`);
    }
  });
}

if (import.meta.main) {
  await startServer();
}
