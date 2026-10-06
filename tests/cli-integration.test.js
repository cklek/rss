import { expect, test } from "bun:test";
import config from "../src/cli/commands.js";
import { cli, fixture, startApp, runner, jsonArgs } from "./cli-helpers.js";

test("all RSS CLI commands operate on an isolated feed and bookmark store", async () => {
  const files = await fixture();
  const feed = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        '<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><link>https://example.test</link><description>Test</description><item><title>CLI item</title><link>https://example.test/item</link><guid>item-1</guid><description>Test summary</description></item></channel></rss>',
        { headers: { "Content-Type": "application/rss+xml" } },
      ),
  });
  let app;
  try {
    app = await startApp(files.dir, { RSS_ALLOW_PRIVATE: "1" });
    expect((await fetch(app.baseUrl + "/")).status).toBe(404);
    const { run, seen } = runner(app.baseUrl);
    const url = `http://127.0.0.1:${feed.port}/feed.xml`;
    const { feed: subscription } = await run(
      "feeds subscribe",
      jsonArgs({ url, name: "CLI Feed", tags: ["test"] }),
    );
    expect(
      (await run("feeds list")).feeds.some((f) => f.slug === subscription.slug),
    ).toBe(true);
    expect(
      (
        await run("feeds update", [
          "--slug",
          subscription.slug,
          ...jsonArgs({ name: "Renamed" }),
        ])
      ).feed.name,
    ).toBe("Renamed");
    const items = await run("items list", [
      "--feed",
      subscription.slug,
      "--fresh",
      "1",
      "--limit",
      "1",
    ]);
    expect(items.items).toHaveLength(1);
    expect(items.items[0].title).toBe("CLI item");
    const body = { item: items.items[0], itemKey: "fixture:item?x=1&y=2" };
    const first = await run("bookmarks save", jsonArgs(body));
    expect(
      (
        await run("bookmarks list", [
          "--q",
          "CLI item",
          "--feed",
          subscription.slug,
          "--limit",
          "5",
        ])
      ).bookmarks,
    ).toHaveLength(1);
    expect(
      (await run("bookmarks delete", ["--id", String(first.bookmark.id)]))
        .deleted,
    ).toBe(true);
    await run("bookmarks save", jsonArgs(body));
    expect(
      (await run("bookmarks delete-key", ["--itemKey", body.itemKey])).deleted,
    ).toBe(true);
    expect(
      (await run("feeds delete", ["--slug", subscription.slug])).deleted,
    ).toBe(true);
    expect((await run("bookmarks list")).bookmarks).toHaveLength(0);
    const failure = await cli(["items", "list", "--feed", "missing"], {
      baseUrl: app.baseUrl,
    });
    expect(failure.code).toBe(1);
    expect([...seen].sort()).toEqual(config.commands.map((c) => c.name).sort());
  } finally {
    await app?.stop();
    feed.stop(true);
    await files.cleanup();
  }
}, 30000);
