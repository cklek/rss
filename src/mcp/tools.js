import commands from "../cli/commands.js";

const tags = {
  type: ["array", "string"],
  items: { type: "string" },
  description:
    'Tags as a list or comma-separated string; lower-cased, up to 8. Defaults to ["custom"].',
};
const limit = (fallback) => ({
  type: "integer",
  description: `Maximum items, 1 to 120. Defaults to ${fallback}.`,
});

export default {
  ...commands,
  title: "RSS",
  instructions: `
Tools for the rss app: a feed reader with a built-in directory of feeds plus
your own subscriptions, live fetching with a five-minute cache, and starred
items (bookmarks) kept in JSON files. Feeds are named by slug; use "all" to
read every feed at once. rss_items_list fetches over the network, and lists
any feed that failed under \`errors\` without failing the call. Star an item
by passing the item object back to rss_bookmarks_save.`,
  tools: {
    "feeds list": {
      title: "List feeds",
      description:
        "List every feed, directory and custom, with their slugs and tags, plus tag counts.",
      inputSchema: { type: "object", properties: {} },
    },
    "feeds subscribe": {
      title: "Subscribe to a feed",
      description:
        "Subscribe to an RSS or Atom feed by URL. Private-network URLs are refused unless the server sets RSS_ALLOW_PRIVATE=1. Returns the new feed with its slug.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The feed's http(s) URL." },
          name: {
            type: "string",
            description: "Display name. Defaults to the host name.",
          },
          tags,
          slug: {
            type: "string",
            description: "Preferred slug. Defaults to one made from the name.",
          },
        },
        required: ["url"],
      },
      annotations: { destructiveHint: false },
    },
    "feeds update": {
      title: "Update a subscription",
      description:
        "Rename, re-point or re-tag one of your own subscriptions. Directory feeds cannot be changed.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "The subscription's slug." },
          url: { type: "string", description: "New feed URL." },
          name: { type: "string", description: "New display name." },
          tags,
          newSlug: {
            type: "string",
            description: "Rename the slug. Stays unique among feeds.",
          },
        },
        required: ["slug"],
      },
      rename: { newSlug: "slug" },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "feeds delete": {
      title: "Unsubscribe",
      description:
        "Remove one of your own subscriptions. Answers deleted: false for an unknown or directory slug.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "The subscription's slug." },
        },
        required: ["slug"],
      },
    },
    "items list": {
      title: "Read items",
      description:
        "Fetch live items, newest first, from one feed, every feed, or an ad-hoc URL. Feeds that could not be fetched are listed under errors.",
      inputSchema: {
        type: "object",
        properties: {
          feed: {
            type: "string",
            description: 'A feed slug, or "all" (the default).',
          },
          url: {
            type: "string",
            description:
              "Read a feed URL directly without subscribing. Overrides feed.",
          },
          q: {
            type: "string",
            description:
              "Only items whose title, summary, feed or tags contain this text.",
          },
          limit: limit(40),
          fresh: {
            type: "boolean",
            description: "Bypass the five-minute cache.",
          },
        },
      },
      annotations: { openWorldHint: true },
    },
    "bookmarks list": {
      title: "List bookmarks",
      description: "List starred items, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description:
              "Only bookmarks whose title, summary, feed or URL contain this text.",
          },
          feed: {
            type: "string",
            description: 'Only this feed slug ("all" for every feed).',
          },
          limit: limit(40),
        },
      },
    },
    "bookmarks save": {
      title: "Star an item",
      description:
        "Star an item: pass the item object from rss_items_list. Saving the same itemKey again updates the bookmark instead of duplicating it.",
      inputSchema: {
        type: "object",
        properties: {
          item: {
            type: "object",
            description:
              "The item as returned by rss_items_list (url and title are required).",
            properties: {
              id: { type: "string" },
              feedSlug: { type: "string" },
              feedName: { type: "string" },
              feedTags: { type: "array", items: { type: "string" } },
              guid: { type: ["string", "null"] },
              url: { type: "string" },
              title: { type: "string" },
              summary: { type: ["string", "null"] },
              author: { type: ["string", "null"] },
              publishedAt: { type: ["string", "null"] },
              categories: { type: "array", items: { type: "string" } },
            },
            required: ["url", "title"],
          },
          itemKey: {
            type: "string",
            description:
              "Key the bookmark is stored under. Defaults to the item's id.",
          },
        },
        required: ["item"],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "bookmarks delete": {
      title: "Unstar by id",
      description: "Remove a bookmark by its numeric id.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Bookmark id." },
        },
        required: ["id"],
      },
    },
    "bookmarks delete-key": {
      title: "Unstar by key",
      description: "Remove a bookmark by the itemKey it was saved under.",
      inputSchema: {
        type: "object",
        properties: {
          itemKey: { type: "string", description: "The bookmark's itemKey." },
        },
        required: ["itemKey"],
      },
    },
  },
};
