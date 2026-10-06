const headless = process.env.HEADLESS === "1";
const index = headless ? null : (await import("./index.html")).default;
import mcpConfig from "./src/mcp/tools.js";
import { createMcpHttpHandler, loopbackUrl } from "./src/mcp/runtime.js";
import {
  RssError,
  createStore,
  deleteBookmark,
  listBookmarks,
  listFeeds,
  listItems,
  saveBookmark,
  subscribe,
  unsubscribe,
  updateSubscription,
} from "./src/server/store.js";

const store = createStore(process.env.RSS_DATA_DIR || "./data");
const json = (body, status = 200) => Response.json(body, { status });

async function jsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

function wrap(handler) {
  return async (req) => {
    try {
      return await handler(req, new URL(req.url));
    } catch (error) {
      if (error instanceof RssError)
        return json({ error: error.message }, error.status);
      return json(
        { error: error instanceof Error ? error.message : "Request failed." },
        500,
      );
    }
  };
}

/* MCP over streamable HTTP: the same API, as tools. The handler calls back
 * into this server over loopback, so it needs the address after the fact. */
const mcp = createMcpHttpHandler(mcpConfig, {
  baseUrl: () => loopbackUrl(server),
});

const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  hostname: process.env.HOST || "0.0.0.0",
  development: process.env.NODE_ENV !== "production",
  idleTimeout: 60,
  routes: {
    ...(headless ? {} : { "/": index }),
    "/api/feeds": {
      GET: wrap(async () => json(await listFeeds(store))),
      POST: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(await subscribe(store, body), 201);
      }),
    },
    "/api/feeds/:slug": {
      PATCH: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(
          await updateSubscription(
            store,
            decodeURIComponent(req.params.slug),
            body,
          ),
        );
      }),
      DELETE: wrap(async (req) =>
        json(await unsubscribe(store, decodeURIComponent(req.params.slug))),
      ),
    },
    "/api/items": {
      GET: wrap(async (req, url) =>
        json(
          await listItems(store, {
            feed: url.searchParams.get("feed"),
            url: url.searchParams.get("url"),
            q: url.searchParams.get("q"),
            limit: url.searchParams.get("limit"),
            fresh: url.searchParams.get("fresh") === "1",
          }),
        ),
      ),
    },
    "/api/bookmarks": {
      GET: wrap(async (req, url) =>
        json(
          await listBookmarks(store, {
            q: url.searchParams.get("q"),
            feed: url.searchParams.get("feed"),
            limit: url.searchParams.get("limit"),
          }),
        ),
      ),
      POST: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        const { bookmark, created } = await saveBookmark(store, body);
        return json({ bookmark }, created ? 201 : 200);
      }),
      DELETE: wrap(async (req, url) => {
        const itemKey = url.searchParams.get("itemKey");
        if (!itemKey) return json({ error: "itemKey is required." }, 400);
        return json(await deleteBookmark(store, { itemKey }));
      }),
    },
    "/api/bookmarks/:id": {
      DELETE: wrap(async (req) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0)
          return json({ error: "Invalid bookmark id." }, 400);
        return json(await deleteBookmark(store, { id }));
      }),
    },
    "/mcp": mcp,
    "/api/*": () => json({ error: "Not found" }, 404),
  },
  fetch: () => headless ? json({ error: "Not found" }, 404) : new Response(index),
});

console.log(
  `rss  http://localhost:${server.port}  (data in ${store.feedsFile.replace(/feeds\.json$/, "")})`,
);
