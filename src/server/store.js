import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import directory from "./directory.json";
import { fetchFeed } from "./feed.js";

const MAX_LIMIT = 120;
const DEFAULT_LIMIT = 40;
const ITEM_CACHE_MS = 5 * 60 * 1000;

export class RssError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const inline = (value, max) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const long = (value, max) =>
  String(value || "")
    .trim()
    .slice(0, max);

function stringArray(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => inline(item, 80))
    .filter(Boolean)
    .slice(0, max);
}

function cleanTags(value) {
  const list =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : [];
  return list
    .map((item) => inline(item, 40).toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

function slugFor(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "feed"
  );
}

function hostFor(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

export function feedForUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new RssError("Feed URL is not a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new RssError("Only http and https feed URLs are supported.");
  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(host) ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate && process.env.RSS_ALLOW_PRIVATE !== "1")
    throw new RssError("Private network feed URLs are not allowed.");
  return {
    slug: `custom-${slugFor(parsed.hostname)}`,
    name: hostFor(url),
    url,
    tags: ["custom"],
  };
}

export function createStore(dir) {
  const root = path.resolve(dir);
  return {
    feedsFile: path.join(root, "feeds.json"),
    bookmarksFile: path.join(root, "bookmarks.json"),
    queue: Promise.resolve(),
    itemCache: new Map(),
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

function locked(store, task) {
  const next = store.queue.then(task, task);
  store.queue = next.catch(() => {});
  return next;
}

async function customFeeds(store) {
  const parsed = await readJson(store.feedsFile, { feeds: [] });
  return (Array.isArray(parsed.feeds) ? parsed.feeds : []).filter(
    (feed) =>
      feed && typeof feed.slug === "string" && typeof feed.url === "string",
  );
}

function tagGroups(feeds) {
  const groups = new Map();
  for (const feed of feeds)
    for (const tag of feed.tags || [])
      groups.set(tag, (groups.get(tag) || 0) + 1);
  return [...groups.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

export async function listFeeds(store) {
  const custom = await customFeeds(store);
  const feeds = [...directory.feeds, ...custom];
  return { feeds, tags: tagGroups(feeds) };
}

function feedInput(body, existing) {
  const url = inline(body?.url ?? existing?.url, 2000);
  if (!url) throw new RssError("Feed URL is required.");
  const safe = feedForUrl(url);
  const tags = cleanTags(body?.tags);
  return {
    name: inline(body?.name, 160) || existing?.name || safe.name,
    url,
    tags: tags.length
      ? tags
      : existing?.tags?.length
        ? existing.tags
        : ["custom"],
  };
}

function uniqueSlug(base, feeds, current) {
  const taken = new Set(
    feeds.map((feed) => feed.slug).filter((slug) => slug !== current),
  );
  if (!taken.has(base)) return base;
  for (let index = 2; index < 100; index += 1)
    if (!taken.has(`${base}-${index}`)) return `${base}-${index}`;
  return `${base}-${Date.now()}`;
}

const byName = (a, b) => a.name.localeCompare(b.name);

export function subscribe(store, body) {
  return locked(store, async () => {
    const current = await customFeeds(store);
    const input = feedInput(body);
    const now = new Date().toISOString();
    const slug = uniqueSlug(slugFor(inline(body?.slug, 120) || input.name), [
      ...directory.feeds,
      ...current,
    ]);
    const feed = {
      ...input,
      slug,
      custom: true,
      createdAt: now,
      updatedAt: now,
    };
    const feeds = [...current, feed].sort(byName);
    await writeJson(store.feedsFile, { version: 1, feeds });
    return { feed, feeds };
  });
}

export function updateSubscription(store, slug, body) {
  return locked(store, async () => {
    const current = await customFeeds(store);
    const existing = current.find((feed) => feed.slug === slug);
    if (!existing) throw new RssError("Feed not found.", 404);
    const input = feedInput(body, existing);
    const nextSlug = uniqueSlug(
      slugFor(inline(body?.slug, 120) || existing.slug),
      [...directory.feeds, ...current],
      existing.slug,
    );
    const feed = {
      ...existing,
      ...input,
      slug: nextSlug,
      updatedAt: new Date().toISOString(),
    };
    const feeds = current
      .map((item) => (item.slug === slug ? feed : item))
      .sort(byName);
    await writeJson(store.feedsFile, { version: 1, feeds });
    store.itemCache.delete(slug);
    return { feed, feeds };
  });
}

export function unsubscribe(store, slug) {
  return locked(store, async () => {
    const current = await customFeeds(store);
    const feeds = current.filter((feed) => feed.slug !== slug);
    if (feeds.length === current.length) return { deleted: false, feeds };
    await writeJson(store.feedsFile, { version: 1, feeds });
    store.itemCache.delete(slug);
    return { deleted: true, feeds };
  });
}

/* Cached by URL, stamped per feed: two subscriptions to one URL share a
 * download but each item still names the feed it was read through. */
async function fetchCached(store, feed) {
  const cached = store.itemCache.get(feed.url);
  let items =
    cached && Date.now() - cached.at < ITEM_CACHE_MS ? cached.items : null;
  if (!items) {
    items = (await fetchFeed(feed)).items;
    store.itemCache.set(feed.url, { at: Date.now(), items });
  }
  return items.map((item) => ({
    ...item,
    feedSlug: feed.slug,
    feedName: feed.name,
    feedTags: feed.tags || [],
  }));
}

function serializeItem(item) {
  return {
    id: `${item.feedSlug}:${item.guid || item.url}`,
    feedSlug: item.feedSlug,
    feedName: item.feedName,
    feedTags: item.feedTags,
    guid: item.guid,
    url: item.url,
    title: item.title,
    summary: item.summary,
    author: item.author || null,
    publishedAt: item.publishedAt,
    categories: item.categories,
  };
}

export async function listItems(store, query = {}) {
  const limit = clampLimit(query.limit);
  const { feeds } = await listFeeds(store);
  const feedSlug = inline(query.feed, 160);
  const customUrl = inline(query.url, 2000);
  const selected = customUrl
    ? [feedForUrl(customUrl)]
    : feedSlug && feedSlug !== "all"
      ? feeds.filter((feed) => feed.slug === feedSlug)
      : feeds;
  if (selected.length === 0)
    throw new RssError(`Unknown feed: ${feedSlug}`, 404);
  if (query.fresh)
    for (const feed of selected) store.itemCache.delete(feed.url);
  const results = await Promise.allSettled(
    selected.map((feed) => fetchCached(store, feed)),
  );
  const items = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else
      errors.push({
        feedSlug: selected[index].slug,
        message:
          result.reason instanceof Error
            ? result.reason.message
            : "Failed to fetch feed",
      });
  });
  const needle = inline(query.q, 160).toLowerCase();
  const seen = new Set();
  const sorted = items
    .filter((item) => {
      const id = `${item.feedSlug}:${item.guid || item.url}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .filter(
      (item) =>
        !needle ||
        [item.title, item.summary, item.feedName, ...(item.feedTags || [])]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    )
    .sort(
      (a, b) =>
        (b.publishedAt ? Date.parse(b.publishedAt) : 0) -
        (a.publishedAt ? Date.parse(a.publishedAt) : 0),
    )
    .slice(0, limit);
  return {
    feed: customUrl ? selected[0].slug : feedSlug || "all",
    feeds: selected,
    items: sorted.map(serializeItem),
    errors,
    limit,
  };
}

async function bookmarks(store) {
  const parsed = await readJson(store.bookmarksFile, {
    nextId: 1,
    bookmarks: [],
  });
  return {
    nextId: Number(parsed.nextId) || 1,
    bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
  };
}

export async function listBookmarks(store, query = {}) {
  const limit = clampLimit(query.limit);
  const search = inline(query.q, 160).toLowerCase();
  const feed = inline(query.feed, 120);
  const { bookmarks: all } = await bookmarks(store);
  const rows = all
    .filter((row) => !feed || feed === "all" || row.feedSlug === feed)
    .filter(
      (row) =>
        !search ||
        [row.title, row.summary, row.feedName, row.url]
          .join(" ")
          .toLowerCase()
          .includes(search),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return { bookmarks: rows, limit };
}

function bookmarkInput(body) {
  const item = body?.item && typeof body.item === "object" ? body.item : body;
  const url = inline(item?.url, 2000);
  const feedSlug = inline(item?.feedSlug, 160) || "custom";
  const guid = inline(item?.guid, 2000) || null;
  return {
    itemKey:
      inline(body?.itemKey || item?.itemKey || item?.id, 2200) ||
      `${feedSlug}:${guid || url}`,
    feedSlug,
    feedName: inline(item?.feedName, 240) || feedSlug,
    feedTags: stringArray(item?.feedTags),
    guid,
    url,
    title: inline(item?.title, 400) || url,
    summary: long(item?.summary, 5000),
    author: inline(item?.author, 240) || null,
    publishedAt:
      item?.publishedAt && !Number.isNaN(Date.parse(item.publishedAt))
        ? new Date(item.publishedAt).toISOString()
        : null,
    categories: stringArray(item?.categories),
  };
}

export function saveBookmark(store, body) {
  return locked(store, async () => {
    const input = bookmarkInput(body);
    if (!input.url || !input.title)
      throw new RssError("Bookmark requires a URL and title.");
    const state = await bookmarks(store);
    const now = new Date().toISOString();
    const index = state.bookmarks.findIndex(
      (row) => row.itemKey === input.itemKey,
    );
    let bookmark;
    if (index >= 0) {
      bookmark = { ...state.bookmarks[index], ...input, updatedAt: now };
      state.bookmarks[index] = bookmark;
    } else {
      bookmark = { id: state.nextId, ...input, createdAt: now, updatedAt: now };
      state.nextId += 1;
      state.bookmarks.push(bookmark);
    }
    await writeJson(store.bookmarksFile, state);
    return { bookmark, created: index < 0 };
  });
}

export function deleteBookmark(store, { id, itemKey }) {
  return locked(store, async () => {
    const state = await bookmarks(store);
    const index = state.bookmarks.findIndex((row) =>
      id ? row.id === id : row.itemKey === itemKey,
    );
    if (index < 0) return { deleted: false };
    state.bookmarks.splice(index, 1);
    await writeJson(store.bookmarksFile, state);
    return { deleted: true };
  });
}
