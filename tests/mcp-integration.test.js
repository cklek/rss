import { expect, test } from "bun:test";
import config from "../src/mcp/tools.js";
import { compileTools } from "../src/mcp/runtime.js";
import { connect, fixture, startApp } from "./mcp-helpers.js";

test("every RSS MCP tool operates on an isolated feed and bookmark store", async () => {
  const files = await fixture();
  const feed = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/broken"
        ? new Response("no", { status: 500 })
        : new Response(
            '<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><link>https://example.test</link><description>Test</description><item><title>MCP item</title><link>https://example.test/item</link><guid>item-1</guid><description>Test summary</description></item></channel></rss>',
            { headers: { "Content-Type": "application/rss+xml" } },
          ),
  });
  let app;
  try {
    app = await startApp(files.dir, { RSS_ALLOW_PRIVATE: "1" });
    const mcp = connect(app.baseUrl);
    await mcp.initialize();
    const url = `http://127.0.0.1:${feed.port}/feed.xml`;
    const { feed: subscription } = await mcp.tool("rss_feeds_subscribe", {
      url,
      name: "MCP Feed",
      tags: ["test"],
    });
    expect(
      (await mcp.tool("rss_feeds_list")).feeds.some(
        (f) => f.slug === subscription.slug,
      ),
    ).toBe(true);
    const renamed = await mcp.tool("rss_feeds_update", {
      slug: subscription.slug,
      name: "Renamed",
      newSlug: "mcp-renamed",
    });
    expect(renamed.feed).toMatchObject({
      name: "Renamed",
      slug: "mcp-renamed",
    });
    const slug = renamed.feed.slug;
    const items = await mcp.tool("rss_items_list", {
      feed: slug,
      fresh: true,
      limit: 1,
    });
    expect(items.items).toHaveLength(1);
    expect(items.items[0].title).toBe("MCP item");
    expect(items.errors).toEqual([]);
    const broken = await mcp.tool("rss_feeds_subscribe", {
      url: `http://127.0.0.1:${feed.port}/broken`,
      name: "Broken",
    });
    const mixed = await mcp.tool("rss_items_list", {
      feed: "all",
      q: "MCP item",
      fresh: true,
    });
    expect(mixed.items.map((i) => i.title)).toEqual(["MCP item"]);
    expect(mixed.errors.map((e) => e.feedSlug)).toEqual([broken.feed.slug]);
    await mcp.tool("rss_feeds_delete", { slug: broken.feed.slug });
    const body = { item: items.items[0], itemKey: "fixture:item?x=1&y=2" };
    const first = await mcp.tool("rss_bookmarks_save", body);
    expect(
      (
        await mcp.tool("rss_bookmarks_list", {
          q: "MCP item",
          feed: slug,
          limit: 5,
        })
      ).bookmarks,
    ).toHaveLength(1);
    expect(
      (await mcp.tool("rss_bookmarks_delete", { id: first.bookmark.id }))
        .deleted,
    ).toBe(true);
    await mcp.tool("rss_bookmarks_save", body);
    expect(
      (await mcp.tool("rss_bookmarks_delete_key", { itemKey: body.itemKey }))
        .deleted,
    ).toBe(true);
    expect((await mcp.tool("rss_feeds_delete", { slug })).deleted).toBe(true);
    expect((await mcp.tool("rss_bookmarks_list")).bookmarks).toHaveLength(0);
    const missing = await mcp.tool(
      "rss_items_list",
      { feed: "missing" },
      { expectError: true },
    );
    expect(missing.status).toBe(404);
    expect([...mcp.seen].sort()).toEqual(
      compileTools(config)
        .map((t) => t.name)
        .sort(),
    );
  } finally {
    await app?.stop();
    feed.stop(true);
    await files.cleanup();
  }
}, 30000);
