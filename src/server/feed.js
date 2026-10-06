function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_FEED_BYTES = 8_000_000;
const USER_AGENT = "Mozilla/5.0 (compatible; rss-reader/1.0)";

function tagInner(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(re);
  if (!match) return undefined;
  return match[1];
}

function tagInnerAll(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out = [];
  for (const match of xml.matchAll(re)) {
    if (match[1] !== undefined) out.push(match[1]);
  }
  return out;
}

function stripCdata(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function cleanText(value) {
  if (!value) return "";
  const withoutCdata = stripCdata(value);
  const markup = decodeHtmlEntities(withoutCdata);
  const withoutTags = markup.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function attribute(tagFragment, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const re2 = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i");
  const match = tagFragment.match(re) || tagFragment.match(re2);
  return match?.[1];
}

function parseRssDate(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

function isAtomFeed(xml) {
  return /<feed\b/i.test(xml) && /<entry\b/i.test(xml);
}

function extractAtomItemLink(itemXml) {
  const linkTagMatch = itemXml.match(/<link\b([^>]*)\/?>(?:<\/link>)?/i);
  if (!linkTagMatch) return "";
  const inner = tagInner(itemXml, "link");
  if (inner) return cleanText(inner);
  return attribute(linkTagMatch[1] || "", "href") || "";
}

function parseAtomFeed(xml, config) {
  const entries = tagInnerAll(xml, "entry");
  return entries.map((entry) => {
    const guidRaw = tagInner(entry, "id") || "";
    const titleRaw = tagInner(entry, "title") || "";
    const summaryRaw =
      tagInner(entry, "summary") || tagInner(entry, "content") || "";
    const authorBlock = tagInner(entry, "author") || "";
    const authorName = tagInner(authorBlock, "name");
    const updated =
      tagInner(entry, "published") || tagInner(entry, "updated") || "";
    const categoryAttrs = Array.from(
      entry.matchAll(/<category\b([^>]*?)\/?>/gi),
    )
      .map((match) => attribute(match[1] || "", "term"))
      .filter((value) => Boolean(value));
    return {
      feedSlug: config.slug,
      feedName: config.name,
      feedTags: config.tags,
      guid: cleanText(guidRaw) || extractAtomItemLink(entry),
      url: extractAtomItemLink(entry),
      title: cleanText(titleRaw),
      summary: cleanText(summaryRaw).slice(0, 2000),
      author: cleanText(authorName),
      publishedAt: parseRssDate(cleanText(updated)),
      categories: categoryAttrs,
    };
  });
}

function parseRssFeed(xml, config) {
  const items = tagInnerAll(xml, "item");
  return items.map((item) => {
    const link =
      cleanText(tagInner(item, "link")) || attribute(item, "href") || "";
    const guid = cleanText(tagInner(item, "guid")) || link;
    const title = cleanText(tagInner(item, "title"));
    const summary = cleanText(
      tagInner(item, "description") || tagInner(item, "content:encoded") || "",
    ).slice(0, 2000);
    const author = cleanText(
      tagInner(item, "author") || tagInner(item, "dc:creator") || "",
    );
    const pubDate = cleanText(
      tagInner(item, "pubDate") || tagInner(item, "dc:date") || "",
    );
    const categories = tagInnerAll(item, "category")
      .map((value) => cleanText(value))
      .filter(Boolean);
    return {
      feedSlug: config.slug,
      feedName: config.name,
      feedTags: config.tags,
      guid,
      url: link,
      title,
      summary,
      author,
      publishedAt: parseRssDate(pubDate),
      categories,
    };
  });
}

export function parseFeedXml(xml, config) {
  const items = isAtomFeed(xml)
    ? parseAtomFeed(xml, config)
    : parseRssFeed(xml, config);
  return items.filter((item) => item.url);
}

export async function fetchFeed(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(config.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`${config.slug}: HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FEED_BYTES) {
      throw new Error(`${config.slug}: feed exceeds ${MAX_FEED_BYTES} bytes`);
    }
    const xml = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return { xml, items: parseFeedXml(xml, config) };
  } finally {
    clearTimeout(timer);
  }
}
