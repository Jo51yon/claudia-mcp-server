import { buildRpcArgs, type ClaudiaMcpToolDef } from './tools.ts';

let failures = 0;
function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL: ${label} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failures++;
  } else console.log(`OK: ${label}`);
}

const searchTool: ClaudiaMcpToolDef = {
  name: 'search_knowledge', description: '', inputSchema: {},
  rpc: 'claudia_knowledge_search_articles',
  argsMap: { query: 'p_query', topic_id: 'p_topic_id' },
  fixedArgs: { p_project_slug: 'petgi' },
};

// Real case: caller supplies both mapped args.
assertEqual(
  buildRpcArgs(searchTool, { query: 'onboarding', topic_id: 'abc-123' }),
  { p_query: 'onboarding', p_topic_id: 'abc-123', p_project_slug: 'petgi' },
  'both mapped args present, fixedArgs merged in',
);

// Real edge case: caller omits an optional arg entirely -- must become null, not undefined
// (undefined would silently drop the key from the JSON RPC payload, which Postgres might
// treat differently than an explicit null default).
assertEqual(
  buildRpcArgs(searchTool, { query: 'onboarding' }),
  { p_query: 'onboarding', p_topic_id: null, p_project_slug: 'petgi' },
  'missing optional arg becomes explicit null, not silently dropped',
);

// Real, important security case: fixedArgs must win even if the caller tries to smuggle their
// own value under the SAME rpc param name via an unrelated call-arg key -- fixedArgs is spread
// last precisely so a project's own binding (e.g. its project slug) can never be overridden by
// a connected agent's tool call.
assertEqual(
  buildRpcArgs(searchTool, { query: 'x', p_project_slug: 'attacker-project' } as any),
  { p_query: 'x', p_topic_id: null, p_project_slug: 'petgi' },
  'fixedArgs cannot be overridden by a same-named but unmapped call arg',
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
Deno.exit(failures === 0 ? 0 : 1);
