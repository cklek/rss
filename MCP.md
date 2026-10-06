# rss MCP server

The app is a [Model Context Protocol](https://modelcontextprotocol.io) server:
every HTTP API route is a tool, so an agent can drive rss the way the page
and the headless CLI do. The tools call the same `/api` routes, so what a
tool can do is exactly what the API can do, no more and no less.

There are two ways in:

- **Streamable HTTP**, built into the app server at `POST /mcp`. It is there
  whenever the app is running, in `bun dev`, `bun start` or
  `bun run headless`. Nothing extra to start.
- **stdio**, `bun run mcp`, for clients that launch a server process. It
  connects to a running app server, or starts its own API-only one with
  `--start`.

## Connect

With the app running on port 3000:

```sh
claude mcp add --transport http rss http://localhost:3000/mcp
```

For a client that launches processes (Claude Desktop, Codex, Claude Code with
stdio), point it at `mcp.js` and let it start its own server:

```json
{
  "mcpServers": {
    "rss": {
      "command": "bun",
      "args": ["/path/to/rss/mcp.js", "--start"]
    }
  }
}
```

`--start` runs `HEADLESS=1 HOST=127.0.0.1 PORT=0 bun server.js` from this
repository, with the same data directory and environment as `bun dev`, and
stops it when the client disconnects. Do not use it while another server is
already running against the same data directory: connect to that server
instead. Without `--start`, the URL precedence is `--base-url`, then
`RSS_API_URL`, then `http://localhost:3000`. `bun run mcp --help` lists the
tools without needing a server.

The package declares the `rss-mcp` executable, available after an optional
`bun link`, alongside `rss-cli`.

## Tools

| Tool                       | HTTP API                    | Purpose                                                                                                                                                   |
| -------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rss_feeds_list`           | `GET /api/feeds`            | List every feed, directory and custom, with their slugs and tags, plus tag counts.                                                                        |
| `rss_feeds_subscribe`      | `POST /api/feeds`           | Subscribe to an RSS or Atom feed by URL. Private-network URLs are refused unless the server sets RSS_ALLOW_PRIVATE=1. Returns the new feed with its slug. |
| `rss_feeds_update`         | `PATCH /api/feeds/:slug`    | Rename, re-point or re-tag one of your own subscriptions. Directory feeds cannot be changed.                                                              |
| `rss_feeds_delete`         | `DELETE /api/feeds/:slug`   | Remove one of your own subscriptions. Answers deleted: false for an unknown or directory slug.                                                            |
| `rss_items_list`           | `GET /api/items`            | Fetch live items, newest first, from one feed, every feed, or an ad-hoc URL. Feeds that could not be fetched are listed under errors.                     |
| `rss_bookmarks_list`       | `GET /api/bookmarks`        | List starred items, newest first.                                                                                                                         |
| `rss_bookmarks_save`       | `POST /api/bookmarks`       | Star an item: pass the item object from rss_items_list. Saving the same itemKey again updates the bookmark instead of duplicating it.                     |
| `rss_bookmarks_delete`     | `DELETE /api/bookmarks/:id` | Remove a bookmark by its numeric id.                                                                                                                      |
| `rss_bookmarks_delete_key` | `DELETE /api/bookmarks`     | Remove a bookmark by the itemKey it was saved under.                                                                                                      |

Every tool takes one JSON object. Its schema (from `tools/list`) names each
argument and marks the required ones; the runtime rejects a missing required
argument, a wrong type, a value outside an enum, or an argument the tool does
not have, before anything is sent. Path parameters (`:id`) and query
parameters are filled from the arguments of the same name; whatever is left
becomes the JSON body. The API applies its own domain rules after that, the
same ones the page and the CLI get.

`rss_items_list` fetches feeds over the network; a feed that fails is listed
under `errors` and the call still succeeds with the items it could read. Star
an item by handing the item object from `rss_items_list` to
`rss_bookmarks_save`.

## Examples

Tool calls, as name and arguments:

```
rss_feeds_subscribe {"url":"https://example.test/feed.xml","name":"Example","tags":["news"]}
rss_items_list {"feed":"all","q":"release","limit":20,"fresh":true}
rss_bookmarks_save {"item":{"url":"https://example.test/post","title":"A post","feedSlug":"custom-example-test","guid":"post-1"}}
rss_bookmarks_list {"q":"post"}
```

## Results

- A JSON reply comes back twice: pretty-printed as a `text` block, and as
  `structuredContent` for clients that read it. `isError` is set when the
  API answered an error status (the payload then carries `error`, `status`
  and `details`), when a notebook cell run failed, or when every uploaded
  file was rejected. A partly rejected upload or a feed that failed inside a
  successful list is a success whose payload says what went wrong.
- `notifications/cancelled` aborts the API request behind a call. A call
  that has not answered after 300 seconds is an error.

## Protocol

Protocol version `2025-06-18` (`2025-03-26` and `2024-11-05` are accepted
and echoed back). The server declares the `tools` capability only. The HTTP
transport is stateless: no session id, no server-initiated stream (`GET /mcp`
answers 405), JSON-RPC batches accepted, replies as JSON unless a call asked
for progress, which is answered as server-sent events. A request with an
`Origin` header is refused (403) unless it is a localhost origin or the
server's own host, so a page on another site cannot drive the API through a
browser. The route has exactly the access the API has, which is none: run
with `HOST=127.0.0.1` to keep it on this machine.

## Verification

```sh
bun run test:mcp     # protocol, transport and every tool against a real server
bun run test         # the CLI suite too
```

The MCP tests start isolated servers on ephemeral loopback ports with
temporary data directories, check the protocol against a fixture API (version
negotiation, errors, batches, origins, uploads, downloads, streaming,
cancellation), run every tool against the real server over `/mcp`, and drive
the stdio server both against a running server and with `--start`. Existing
user data is not used.
