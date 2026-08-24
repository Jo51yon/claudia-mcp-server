/**
 * Real config-file loading, not just env vars -- the whole point of this being a real,
 * apt-installable service. Reads /etc/claudia-mcp/config.json by default (overridable via
 * CLAUDIA_MCP_CONFIG for testing or a non-standard install path). Any field can still be
 * overridden by an environment variable of the same name in SCREAMING_SNAKE_CASE, so a real
 * systemd unit can inject secrets via EnvironmentFile= without editing the config file itself
 * -- config file for the stable shape, env vars for the one thing that actually wants to stay
 * out of a file on disk.
 */
export interface ClaudiaMcpConfig {
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey: string;
  projectSlug: string;
  resolveBearerRpc: string;
  resourcePath: string;
  authServer: string;
  toolsFile: string;
}

const REQUIRED: (keyof ClaudiaMcpConfig)[] = [
  'supabaseUrl', 'supabaseServiceRoleKey', 'supabaseAnonKey',
  'projectSlug', 'resolveBearerRpc', 'resourcePath', 'authServer', 'toolsFile',
];

function envOverrideKey(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

export async function loadConfig(path?: string): Promise<ClaudiaMcpConfig> {
  const configPath = path ?? Deno.env.get('CLAUDIA_MCP_CONFIG') ?? '/etc/claudia-mcp/config.json';
  let fileConfig: Partial<ClaudiaMcpConfig> = {};
  try {
    fileConfig = JSON.parse(await Deno.readTextFile(configPath));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw new Error(`Could not read/parse config file at ${configPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // No config file -- fine as long as every required field arrives via env var instead.
  }

  const merged: Record<string, unknown> = { port: 8787, ...fileConfig };
  for (const key of [...REQUIRED, 'port'] as const) {
    const envVal = Deno.env.get(envOverrideKey(key));
    if (envVal !== undefined) merged[key] = key === 'port' ? Number(envVal) : envVal;
  }

  const missing = REQUIRED.filter((k) => !merged[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required config: ${missing.join(', ')}. Set them in ${configPath} or as environment variables (${missing.map(envOverrideKey).join(', ')}).`,
    );
  }

  return merged as unknown as ClaudiaMcpConfig;
}
