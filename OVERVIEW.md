# What claudia-mcp-server is, and how to use it

## The problem this solves

Two real, live projects — `petgi-mcp` and `lintel-mcp`, both Supabase Edge Functions — each
carry their own, independently written copy of the same ~700-line server: JSON-RPC protocol
handling, bearer-token authorization, and a tool-dispatch loop. Lintel's own header comment
says it plainly: it "mirrors petgi-mcp exactly." Every new project that wants to expose its own
data to a connected AI assistant has, until now, meant copying that whole file and swapping in
new tool definitions by hand.

`claudia-mcp-server` is that shared skeleton, pulled out once. A project supplies two small
JSON files — one describing itself, one listing its tools — and gets a real, working MCP server
with no code of its own to write or maintain.

**Current, honest status:** this is not yet what `petgi-mcp`/`lintel-mcp` run in production. It
proves the shared-core-plus-packaging concept end to end, as a new, standalone build. Migrating
the live Edge Functions onto this core is real, separate, deliberately undone work.

## What "MCP server" actually means here

The [Model Context Protocol](https://modelcontextprotocol.io) is how a connected AI assistant
(Claude, or any other MCP-aware client) discovers and calls tools a real backend exposes. This
server speaks that protocol over plain HTTP, as JSON-RPC 2.0:

- `initialize` — the client says hello, the server replies with its identity and capabilities.
- `tools/list` — the server returns every tool this project has defined, with its name,
  description, and expected arguments.
- `tools/call` — the client asks to run one specific tool with specific arguments; the server
  runs it and returns the result.

Every one of those calls (except the initial handshake) requires a real bearer token in the
`Authorization` header. Nothing is served anonymously.

## The real authorization model, and why it's built this way

The bearer token is issued by `claudia-mcp-oauth` and bound to one real user. On every request,
this server resolves that token to a genuine user identity via a Postgres RPC (configurable —
see `resolveBearerRpc` below), then runs the actual tool call **as that user's own real Supabase
session** — `role=authenticated`, `request.jwt.claims` set correctly, so Postgres Row Level
Security applies exactly as it would if that user were using the product's own web UI.

There is no impersonation. There is no `SECURITY DEFINER` bypass anywhere in the tool-call path.
If a tool's underlying RPC would refuse a write for this user in the real app, it refuses it
here too — the server does not have, and deliberately does not want, any special privilege a
real user session doesn't already have.

This matters concretely: a tool that tries to write something outside what RLS allows doesn't
silently no-op. The RPC call itself fails, and the server reports that failure back to the
caller — a connected agent finds out immediately that something was refused, rather than
believing a write landed when it didn't.

## The two files that define a real deployment

### `config.json` — who this deployment is

```json
{
  "port": 8787,
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseServiceRoleKey": "YOUR-SERVICE-ROLE-KEY",
  "supabaseAnonKey": "YOUR-ANON-OR-PUBLISHABLE-KEY",
  "projectSlug": "your-project-slug",
  "resolveBearerRpc": "your_project_mcp_resolve_bearer",
  "resourcePath": "https://your-domain.example/your-project",
  "authServer": "https://your-domain.example/claudia-mcp-oauth/your-project",
  "toolsFile": "/etc/claudia-mcp/tools.json"
}
```

- `supabaseServiceRoleKey` is used once, to resolve a bearer token to a real user — never to
  run a tool call itself. Every actual tool call runs under the resolved user's own session,
  built from `supabaseAnonKey` plus that user's bearer token.
- `resolveBearerRpc` is the name of a real Postgres function this project already has (or needs
  to write): given a token, return `{user_id, email}` for the user it belongs to, or nothing if
  it's invalid/expired. `petgi_mcp_resolve_bearer` and its Lintel equivalent are the real,
  proven examples this pattern is extracted from.
- Any field here can also be set as an environment variable instead — `supabaseServiceRoleKey`
  becomes `SUPABASE_SERVICE_ROLE_KEY`, and so on. A real systemd `EnvironmentFile=` can inject
  secrets this way without ever putting them in the config file on disk.

### `tools.json` — what this deployment can do

Each entry is one real tool, mapped directly onto one Postgres RPC:

```json
[
  {
    "name": "search_knowledge",
    "description": "Search this project's published knowledge base. Returns titles/excerpts, not full bodies -- call get_knowledge_article for the content of one you actually need.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Matches against title and excerpt." },
        "topic_id": { "type": "string", "description": "Restrict to one topic. Optional." }
      }
    },
    "rpc": "claudia_knowledge_search_articles",
    "argsMap": { "query": "p_query", "topic_id": "p_topic_id" },
    "fixedArgs": { "p_project_slug": "your-project-slug" }
  }
]
```

- `description` is what the connected AI actually reads to decide when and how to use the
  tool — write it the way you'd brief a new team member, not a code comment. The real
  `search_knowledge` tool this pattern was proven against deliberately tells the model *not*
  to bulk-read every result "just in case" — the description is real, working guidance, not
  decoration.
- `inputSchema` is a standard [JSON Schema](https://json-schema.org) object describing the
  arguments a caller can supply.
- `argsMap` renames each argument the caller supplies to the real parameter name your Postgres
  RPC expects. An argument the caller omits is passed through as an explicit `null`, not
  silently dropped — verified with a real test, since a dropped key and an explicit null can
  mean different things to a Postgres function with its own default handling.
- `fixedArgs` binds a value the caller can never supply or override — typically your project's
  own slug, so a connected agent can't smuggle in a different one. This is applied *after*
  `argsMap`, deliberately, and is covered by a real test: a call that tries to pass its own
  value under the same key as a `fixedArgs` entry does not win.

## A real walkthrough: adding this to a new project

1. **Write the resolver RPC**, if you don't have one yet — a Postgres function taking a token
   and returning the real user it belongs to. Copy the shape of `petgi_mcp_resolve_bearer`.
2. **Write the RPCs each tool needs.** Nothing about this server requires anything special of
   them beyond being real, callable Postgres functions — RLS does the actual access control.
3. **Fill in `config.json`** with your real project's Supabase URL, keys, slug, and resolver
   RPC name.
4. **Fill in `tools.json`** with one entry per RPC you want to expose, following the shape
   above.
5. **Install and start it** — see the main [README](./README.md) for the real, tested
   `apt-get install` flow, or run the compiled binary directly for local testing:
   ```sh
   CLAUDIA_MCP_CONFIG=./config.json ./claudia-mcp-server
   ```
6. **Point a connected AI client at it.** The exact connection flow depends on the client;
   what matters here is that `initialize`/`tools/list`/`tools/call` all work correctly once a
   real bearer token is presented — which is exactly what the shipped test suite verifies on
   every real build (see `.github/workflows/build-and-release.yml`): a genuinely compiled
   binary, packaged, installed via real `apt-get install`, started as a real systemd-managed
   service, confirmed to correctly refuse an unauthenticated call, then cleanly purged.

## What this doesn't do (yet)

**Custom, hand-written tool logic.** Every tool here is the simple "one RPC call" shape. A real
tool that needs more than that — `petgi-mcp`'s actual `SEND_INVITATION_TOOL`, for instance,
which does more than call a single RPC — isn't representable in `tools.json` yet. A project
needing that today keeps its own hand-rolled server for that one tool, or this core grows a
real extension point for it later. Not invented speculatively here.

**A hosted, signed apt repository.** Today's install is a real `apt-get install` against a
downloaded `.deb` file, not `apt-get install claudia-mcp-server` after adding a repository line
to `sources.list`. That needs real, separate infrastructure — a domain, hosting, GPG key
management — and its own hosting decision, not something built speculatively ahead of that
decision being made.
