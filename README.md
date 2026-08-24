# claudia-mcp-server

A config-driven Model Context Protocol server, extracted from the real, duplicated
`petgi-mcp`/`lintel-mcp` Supabase Edge Functions (708 and 707 lines respectively — Lintel's own
header comment says it "mirrors petgi-mcp exactly"). Handles the JSON-RPC protocol, bearer-token
authorization against `claudia-mcp-oauth`, and a declarative RPC-backed tool dispatch loop.
Project-specific tools are supplied via a JSON file, not code — pointing this at a new project
means editing two config files, not writing a new server.

Compiles to a single, standalone Linux binary (`deno compile`) — no separate runtime needs to be
installed on the target machine — and ships as a real, tested `.deb` package with a systemd unit.

For what this actually does, the real request/auth flow, and a full config.json/tools.json
walkthrough, see [OVERVIEW.md](./OVERVIEW.md).

**Real, current status:** not yet what `petgi-mcp`/`lintel-mcp` run in production. This proves
the shared-core-plus-Debian-packaging concept end to end, on a new, standalone build. Migrating
the live Edge Functions to consume this core is real, separate, undone work — refactoring a
live, traffic-serving service in place without extensive further testing would be reckless.

## Install

Download the latest `.deb` from [Releases](../../releases) and install it directly:

```sh
wget https://github.com/Jo51yon/claudia-mcp-server/releases/latest/download/claudia-mcp-server_VERSION.deb
sudo apt-get install ./claudia-mcp-server_VERSION.deb
```

This is a real `apt-get install` against a local file, not (yet) a hosted apt repository —
there's no `add-apt-repository`/`sources.list` line to add, and no GPG-signed package index.
That's real, separate infrastructure (a domain, hosting, key management) needing its own hosting
decision, not something this repo can stand up on its own. What's here today is genuinely
"one command installs it," just not "add our repo and it's there forever" yet.

Installing creates a dedicated `claudia-mcp` system user (never runs as root), places example
config at `/etc/claudia-mcp/config.json.example` and `/etc/claudia-mcp/tools.json.example`, and
copies them to the real config paths **only if no real config already exists** — an upgrade will
never silently overwrite a real deployment's real config.

```sh
sudo nano /etc/claudia-mcp/config.json   # your real Supabase project details
sudo nano /etc/claudia-mcp/tools.json    # your real tool definitions
sudo systemctl enable --now claudia-mcp-server
sudo systemctl status claudia-mcp-server
```

## Config format

See `packaging/etc/claudia-mcp/config.json.example` and `tools.json.example` for the real,
complete shape. Every config field can also be set as an environment variable
(`SCREAMING_SNAKE_CASE` of the field name — e.g. `supabaseServiceRoleKey` →
`SUPABASE_SERVICE_ROLE_KEY`), so a real systemd `EnvironmentFile=` can inject secrets without
editing the config file on disk.

Each tool in `tools.json` maps one MCP tool call directly to one Postgres RPC:

```json
{
  "name": "search_knowledge",
  "description": "...",
  "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } } },
  "rpc": "claudia_knowledge_search_articles",
  "argsMap": { "query": "p_query" },
  "fixedArgs": { "p_project_slug": "your-project-slug" }
}
```

`argsMap` renames a caller-supplied argument to its real RPC parameter name. `fixedArgs` binds a
value the caller can never override (verified with a real test: a call trying to smuggle its own
value under the same key as a `fixedArgs` entry does not win — `fixedArgs` is applied last,
deliberately, so a project's own binding, like its project slug, can't be overridden by a
connected agent's tool call).

## Building from source

```sh
cd src
deno check server.ts                          # type-check
deno run --allow-all test_buildRpcArgs.ts      # real, isolated logic tests
deno compile --allow-net --allow-env --allow-read -o ../claudia-mcp-server server.ts
```

The compiled binary is genuinely standalone (~107MB, since it embeds the full V8 engine and Deno
runtime) — no Deno install needed on the machine that runs it, only on the machine that builds it.

## What's not ported

Custom, hand-written tools (not the simple `rpc`+`argsMap` shape) — e.g. `petgi-mcp`'s real
`SEND_INVITATION_TOOL`, which does more than call one RPC — aren't representable in the JSON
tools format yet. A project needing that today keeps using its own hand-rolled server, or this
core gains a real extension point for it later; not invented speculatively here.
