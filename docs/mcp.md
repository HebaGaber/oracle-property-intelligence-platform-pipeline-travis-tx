# CountyLens MCP server

T028 (A-14/A-15, G-3). CountyLens's own MCP server (AD-21): a Lambda separate from the tRPC API
and from the AI agent, serving exactly six fixed tools over the published `contract/v1` views.
There is no SQL tool and no seventh tool (P0-13) — `get_schema` is how a client learns what each
column means without one.

- Hosted: `POST https://<api-host>/mcp` (Streamable HTTP), `GET https://<api-host>/health` (no
  auth). The exact host is the deployed `CountyLensApi` stack's HTTP API URL (see
  `docs/evidence/A-14-mcp.md` for the value used in grading).
- Local: `apps/api/src/mcp/stdio.ts`, over stdio, for development only (see "Local development"
  below). It is never the graded demo surface.

Every call except `GET /health` requires `Authorization: Bearer <token>`. **Never put a real
token in this file, in a commit, or in a screenshot** — the placeholder below is exactly that, a
placeholder; the real value lives only in SSM (`/countylens/mcp/token`, a SecureString) and in
whatever secret store the person running the demo keeps it in.

## Claude Desktop

Claude Desktop only speaks stdio to a locally spawned process, so it uses the local build, not
the hosted route directly. Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "countylens": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/apps/api/src/mcp/stdio.ts"],
      "env": {
        "RUNS_TABLES_DIR": "/absolute/path/to/a/local/export-tables/output"
      }
    }
  }
}
```

`RUNS_TABLES_DIR` is optional: without it, `search_properties`/`list_permits`/`get_property`
answer honestly empty (no table parts to read) while `get_schema`, `list_runs`, and
`get_coverage` work from the committed `runs/index.json`/`runs/<runId>/manifest.json` alone (see
"Local development" below for why).

## Claude Code

```bash
claude mcp add countylens --transport http https://<api-host>/mcp \
  --header "Authorization: Bearer <token>"
```

Or, for the local stdio build during development:

```bash
claude mcp add countylens --transport stdio -- node --import tsx apps/api/src/mcp/stdio.ts
```

## MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Connect with:

- Transport: **Streamable HTTP**
- URL: `https://<api-host>/mcp`
- Header: `Authorization: Bearer <token>`

`tools/list` should return the six tools below in well under 500 ms; a wrong or missing token
returns `401` before any row is read. A request that carries a browser `Origin` header is
rejected (`403`) before the token is even checked — the allowlist is empty by design: no
legitimate browser call is ever trusted to hit `/mcp` directly (the website's own "try a tool"
control goes through a server-side proxy that adds the token itself).

## The six tools

Exactly these six (AD-21), each named in `snake_case`. Every `inputSchema` below is generated
straight from the query-core Zod schema each tool adapter uses as its `inputSchema` — the same
object, not a hand-written restatement (`apps/api/src/mcp/tools.ts`'s `MCP_TOOL_SCHEMAS`) — by
calling `get_schema`'s own `tool_inputs` (`z.toJSONSchema`). Field names are the AD-07 column
names (e.g. `roof_age_years_min`, not the website's `roof`).

No sample response is shown here on purpose: every row is live, provenance-stamped data from
whichever run is bound when you call it, not a number this document should freeze.

### `search_properties`

Properties in or near an area, filtered by roof age, tenure, an out-of-area owner, or an
open/stalled roofing permit.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "manifest_cid": { "type": "string" },
    "area": {
      "anyOf": [
        {
          "type": "object",
          "properties": { "place": { "type": "string", "minLength": 1, "maxLength": 100 } },
          "required": ["place"],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "lat": { "type": "number", "minimum": -90, "maximum": 90 },
            "lon": { "type": "number", "minimum": -180, "maximum": 180 }
          },
          "required": ["lat", "lon"],
          "additionalProperties": false
        }
      ]
    },
    "radius_mi": { "type": "number", "minimum": 0.25, "maximum": 25 },
    "roof_age_years_min": { "type": "integer", "minimum": 0, "maximum": 120 },
    "tenure_years_min": { "type": "integer", "minimum": 1, "maximum": 100 },
    "owner_is_out_of_area": { "type": "boolean", "const": true },
    "status_class": { "type": "string", "enum": ["open_or_stalled", "open", "stalled"] },
    "open_years_min": { "type": "number", "minimum": 0, "maximum": 60 },
    "sort": { "default": "nearest", "type": "string", "enum": ["nearest", "open_desc", "roof_desc"] },
    "limit": { "default": 50, "type": "integer", "minimum": 1, "maximum": 1000 }
  },
  "required": ["area", "radius_mi", "sort", "limit"],
  "additionalProperties": false
}
```

### `list_permits`

Roofing permits, county-wide by default (`area` omitted) or inside an area/radius, filtered by
status class, minimum open years, or an exact permit number.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "manifest_cid": { "type": "string" },
    "area": {
      "anyOf": [
        {
          "type": "object",
          "properties": { "place": { "type": "string", "minLength": 1, "maxLength": 100 } },
          "required": ["place"],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "lat": { "type": "number", "minimum": -90, "maximum": 90 },
            "lon": { "type": "number", "minimum": -180, "maximum": 180 }
          },
          "required": ["lat", "lon"],
          "additionalProperties": false
        }
      ]
    },
    "radius_mi": { "type": "number", "minimum": 0.25, "maximum": 25 },
    "permit_number": { "type": "string", "pattern": "^\\d{4}-\\d{6} [A-Z]{2}$" },
    "status_class": { "type": "string", "enum": ["open_or_stalled", "open", "stalled", "closed"] },
    "open_years_min": { "type": "number", "minimum": 0, "maximum": 60 },
    "sort": { "default": "open_desc", "type": "string", "enum": ["open_desc", "nearest", "issue_desc"] },
    "limit": { "default": 50, "type": "integer", "minimum": 1, "maximum": 1000 }
  },
  "required": ["sort", "limit"],
  "additionalProperties": false
}
```

`radius_mi` is required whenever `area` is given (a Zod `.refine`, not expressed in the JSON
Schema above — a request with `area` and no `radius_mi` is still rejected).

### `get_property`

One property by its CID or its TCAD request identifier (exactly one of the two).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "manifest_cid": { "type": "string" },
    "property_cid": { "type": "string" },
    "request_identifier": { "type": "string", "pattern": "^\\d{1,10}$" }
  },
  "additionalProperties": false
}
```

### `get_coverage`

The published run's `coverage` figures, unchanged, for the latest run or a named `manifest_cid`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "manifest_cid": { "type": "string" } },
  "additionalProperties": false
}
```

### `list_runs`

The committed runs index: every published run, newest first.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "limit": { "default": 20, "type": "integer", "minimum": 1, "maximum": 100 } },
  "required": ["limit"],
  "additionalProperties": false
}
```

### `get_schema`

The four contract views' column catalogs (names, types, enums, nullability, missing-field
reasons), the uncarried-field list, and the six tools' own JSON Schemas (the source of every
block on this page).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "view": {
      "type": "string",
      "enum": ["v_property", "v_roofing_permit", "v_contractor", "v_run"]
    }
  },
  "additionalProperties": false
}
```

## Empty results, never invented rows

Every tool distinguishes "valid request, genuinely zero matches" from "something about the
request couldn't be answered": a zero-match success has `empty_reason: null`; a typed reason —
`out_of_scope` (the area isn't in Travis County), `not_found` (an unknown identifier),
`no_match` (a valid filter, zero rows), `field_not_published` (the filtered field is null on
every candidate row), or `run_not_found` (an unknown `manifest_cid`, or no run resolvable at
all) — is set instead. Rows that exceed the 1,000-row cap come back with `truncated: true` and
the true `total`, never a silent cut.

## Local development

`apps/api/src/mcp/stdio.ts` runs the same six tools over a local, in-memory DuckDB (no SSM, no
S3, no bearer token — stdio has no network exposure) by reading `runs/index.json` and
`runs/<runId>/manifest.json` directly off the repo. Setting `RUNS_TABLES_DIR` to a local
export-tables output directory (`<group>/<table>/part-*.parquet`) lets `search_properties`,
`list_permits`, and `get_property` return real rows; without it, `bindManifest` still binds
successfully (every required table the manifest doesn't cover becomes an empty typed table), so
those three tools answer honestly empty instead of crashing, and `get_schema`/`list_runs`/
`get_coverage` work regardless. `RUNS_INDEX_PATH` overrides the default `runs/index.json` path
for a different index.

On the hosted route, `apps/api/src/mcp/runs-index.ts` reads `runs/index.json` straight from the
CID-copy bucket (`CID_COPY_BUCKET`, already set on the MCP Lambda) with one S3 GetObject — the
same bucket and key the agent Lambda's `defaultResolveManifestCid` reads — so `list_runs` and
the "no `manifest_cid` given" default on every other tool resolve the real latest run, not just
when a caller names one explicitly.
