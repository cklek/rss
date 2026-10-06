import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  IconBookmark,
  IconClock,
  IconExternalLink,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconRss,
  IconSearch,
  IconStar,
  IconTrash,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import { AppLayout } from "@/shell/layout";
import { useAppDialog } from "@/shell/dialog";
import { useAppMenu } from "@/shell/menu-context";
import { themeViewItems, useTheme } from "@/lib/theme";
import { useSearchParam, useUpdateSearchParams } from "@/lib/url-query-state";
import { pathWithSearchParams } from "@/lib/url-path";
import { cn } from "@/lib/utils";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { api } from "./client";

const DEFAULT_RECENT_KEY = "rss:recent";

function readRecent(key = DEFAULT_RECENT_KEY) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function writeRecent(next, key = DEFAULT_RECENT_KEY) {
  localStorage.setItem(key, JSON.stringify(next.slice(0, 12)));
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function feedTags(feed) {
  return arrayValue(feed?.tags);
}

function itemFeedTags(item) {
  return arrayValue(item?.feedTags);
}

function relativeTime(value) {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function hostForUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function feedLabel(feed, customUrl) {
  if (customUrl) return hostForUrl(customUrl);
  if (!feed) return "All feeds";
  return feed.name;
}

function itemTime(item) {
  return item.publishedAt ? relativeTime(item.publishedAt) : "";
}

function ReaderMenus({ loadingItems, currentFeedUrl, onRefresh, refreshKey }) {
  const theme = useTheme();
  useAppMenu(
    {
      view: themeViewItems(theme),
      extra: {
        label: "Feed",
        items: [
          {
            id: "refresh",
            label: loadingItems ? "Refreshing…" : "Refresh",
            disabled: loadingItems,
            onSelect: () => {
              onRefresh();
            },
          },
          {
            id: "copy-feed-url",
            label: "Copy feed URL",
            disabled: !currentFeedUrl,
            onSelect: () => {
              void navigator.clipboard
                .writeText(currentFeedUrl)
                .then(() => toast.success("Feed URL copied."))
                .catch(() => toast.error("Could not reach the clipboard."));
            },
          },
          {
            id: "open-feed",
            label: "Open feed source",
            disabled: !currentFeedUrl,
            onSelect: () => {
              window.open(currentFeedUrl, "_blank", "noopener,noreferrer");
            },
          },
        ],
      },
    },
    [theme.id, loadingItems, currentFeedUrl, refreshKey],
  );
  return null;
}

export default function ReaderPage({
  title = "RSS",
  recentKey = DEFAULT_RECENT_KEY,
} = {}) {
  const dialog = useAppDialog();
  const updateSearchParams = useUpdateSearchParams();
  const selectedFeed = useSearchParam("feed") || "all";
  const customUrl = useSearchParam("url");
  const [feeds, setFeeds] = useState([]);
  const [items, setItems] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [tags, setTags] = useState([]);
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [bookmarkingItem, setBookmarkingItem] = useState(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftName, setDraftName] = useState("");
  const [recent, setRecent] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setRecent(readRecent(recentKey));
  }, [recentKey]);

  const loadFeeds = useCallback(async () => {
    setLoadingFeeds(true);
    try {
      const data = await api("/feeds");
      setFeeds(arrayValue(data.feeds));
      setTags(arrayValue(data.tags));
    } catch (error) {
      toast.error(error.message || "Failed to load feeds");
    } finally {
      setLoadingFeeds(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingFeeds(true);
    api("/feeds")
      .then((data) => {
        if (cancelled) return;
        setFeeds(arrayValue(data.feeds));
        setTags(arrayValue(data.tags));
      })
      .catch((error) => toast.error(error.message || "Failed to load feeds"))
      .finally(() => {
        if (!cancelled) setLoadingFeeds(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBookmarks = useCallback(async () => {
    try {
      const data = await api(
        pathWithSearchParams("/bookmarks", { limit: 120 }),
      );
      setBookmarks(arrayValue(data.bookmarks));
    } catch (error) {
      toast.error(error.message || "Failed to load RSS bookmarks");
    }
  }, []);

  useEffect(() => {
    void loadBookmarks();
  }, [loadBookmarks]);
  const loadItems = useCallback(
    async ({ fresh = false } = {}) => {
      if (selectedFeed === "saved" && !customUrl) {
        setItems([]);
        setLoadingItems(false);
        return;
      }
      setLoadingItems(true);
      try {
        const params = new URLSearchParams({ limit: "80" });
        if (fresh) params.set("fresh", "1");
        if (customUrl) params.set("url", customUrl);
        else params.set("feed", selectedFeed);
        const data = await api(`/items?${params.toString()}`);
        setItems(arrayValue(data.items));
        if (customUrl) {
          const next = [
            {
              url: customUrl,
              title: feedLabel(undefined, customUrl),
              visitedAt: Date.now(),
            },
            ...readRecent(recentKey).filter((entry) => entry.url !== customUrl),
          ];
          writeRecent(next, recentKey);
          setRecent(next);
        }
        const errors = arrayValue(data.errors);
        if (errors.length) {
          toast.message(`${errors.length} feed fetches failed`);
        }
      } catch (error) {
        toast.error(error.message || "Failed to fetch RSS items");
        setItems([]);
      } finally {
        setLoadingItems(false);
      }
    },
    [customUrl, recentKey, selectedFeed],
  );

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useAutoRefresh(
    async () => {
      await Promise.all([loadFeeds(), loadBookmarks(), loadItems()]);
    },
    { intervalMs: 120000 },
  );

  const showingSaved = selectedFeed === "saved" && !customUrl;
  const visibleItems = showingSaved ? bookmarks : items;
  const selectedFeedConfig = feeds.find((feed) => feed.slug === selectedFeed);
  const customFeeds = feeds.filter((feed) => feed.custom);
  const directoryFeeds = feeds.filter((feed) => !feed.custom);
  const currentFeedUrl = customUrl || selectedFeedConfig?.url || "";

  const bookmarkByItemKey = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.itemKey, bookmark])),
    [bookmarks],
  );

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return visibleItems;
    return visibleItems.filter((item) =>
      [item.title, item.summary, item.feedName, ...itemFeedTags(item)]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [visibleItems, query]);

  function selectFeed(feed) {
    updateSearchParams({ feed, url: null }, { mode: "push" });
  }

  async function submitCustomFeed(event) {
    event.preventDefault();
    const url = draftUrl.trim();
    if (!url) return;
    try {
      const result = await api("/feeds", {
        method: "POST",
        body: JSON.stringify({
          name: draftName.trim() || undefined,
          url,
          tags: ["custom"],
        }),
      });
      toast.success("Feed added.");
      setDraftName("");
      setDraftUrl("");
      await loadFeeds();
      updateSearchParams(
        { feed: result.feed.slug, url: null },
        { mode: "push" },
      );
    } catch (error) {
      toast.error(error.message || "Could not save RSS feed");
    }
  }

  function openRecent(entry) {
    updateSearchParams({ url: entry.url, feed: null }, { mode: "push" });
  }

  function clearRecent() {
    localStorage.removeItem(recentKey);
    setRecent([]);
  }

  async function editCustomFeed(feed) {
    const name = await dialog.prompt({
      title: "Feed name",
      defaultValue: feed.name,
      inputLabel: "Name",
    });
    if (name === null) return;
    const url = await dialog.prompt({
      title: "Feed URL",
      defaultValue: feed.url,
      inputLabel: "URL",
    });
    if (url === null) return;
    const tags = await dialog.prompt({
      title: "Tags",
      description: "Comma-separated.",
      defaultValue: feedTags(feed).join(", "),
      inputLabel: "Tags",
    });
    if (tags === null) return;
    try {
      const result = await api(`/feeds/${feed.slug}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          url,
          tags,
        }),
      });
      toast.success("Feed updated.");
      await loadFeeds();
      if (selectedFeed === feed.slug) {
        updateSearchParams(
          { feed: result.feed.slug, url: null },
          { mode: "replace" },
        );
      }
    } catch (error) {
      toast.error(error.message || "Could not update RSS feed");
    }
  }

  async function deleteCustomFeed(feed) {
    if (
      !(await dialog.confirm({
        title: `Remove ${feed.name}?`,
        description: "Your bookmarks from it stay.",
        confirmLabel: "Remove",
        tone: "destructive",
      }))
    ) {
      return;
    }
    try {
      await api(`/feeds/${feed.slug}`, {
        method: "DELETE",
      });
      toast.success("Feed removed.");
      await loadFeeds();
      if (selectedFeed === feed.slug) {
        updateSearchParams({ feed: "all", url: null }, { mode: "replace" });
      }
    } catch (error) {
      toast.error(error.message || "Could not remove RSS feed");
    }
  }

  async function toggleBookmark(item) {
    const existing = bookmarkByItemKey.get(item.itemKey || item.id);
    setBookmarkingItem(item.itemKey || item.id);
    try {
      if (existing) {
        const result = await api(`/bookmarks/${existing.id}`, {
          method: "DELETE",
        });
        if (result.deleted) {
          setBookmarks((current) =>
            current.filter((bookmark) => bookmark.id !== existing.id),
          );
          toast.success("Bookmark removed.");
        }
        if (showingSaved) setItems([]);
      } else {
        const result = await api("/bookmarks", {
          method: "POST",
          body: JSON.stringify({ item, itemKey: item.itemKey || item.id }),
        });
        setBookmarks((current) => [
          result.bookmark,
          ...current.filter(
            (bookmark) => bookmark.itemKey !== result.bookmark.itemKey,
          ),
        ]);
        toast.success("Bookmarked.");
      }
    } catch (error) {
      toast.error(error.message || "Bookmark failed");
    } finally {
      setBookmarkingItem(null);
    }
  }

  return (
    <AppLayout title={title} showHeader={false}>
      <ReaderMenus
        loadingItems={loadingItems}
        currentFeedUrl={currentFeedUrl}
        refreshKey={`${selectedFeed}|${customUrl || ""}`}
        onRefresh={() =>
          void Promise.all([
            loadFeeds(),
            loadBookmarks(),
            loadItems({ fresh: true }),
          ])
        }
      />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 rule-b px-3">
          <h1 className="truncate">{title}</h1>
          {loadingItems ? (
            <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
          ) : null}
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 rule-r lg:flex lg:flex-col">
            <div className="rule-b p-3">
              <form onSubmit={(event) => void submitCustomFeed(event)}>
                <div className="grid gap-2">
                  <Input
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder="Feed name"
                  />
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      value={draftUrl}
                      onChange={(event) => setDraftUrl(event.target.value)}
                      placeholder="Feed URL"
                    />
                    <Button type="submit" size="icon-sm" variant="outline">
                      <IconPlus />
                    </Button>
                  </div>
                </div>
              </form>
            </div>
            <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
              <div className="space-y-5">
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => selectFeed("all")}
                    className={cn(
                      "h-8 w-full justify-between inset-ring-1 px-2 text-left transition-colors",
                      !customUrl && selectedFeed === "all"
                        ? "inset-ring-foreground bg-foreground text-background"
                        : "inset-ring-border/70 text-muted-foreground hover:bg-muted/35 hover:text-foreground",
                    )}
                  >
                    <span>All feeds</span>
                    <span>{feeds.length}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => selectFeed("saved")}
                    className={cn(
                      "mt-1 h-8 w-full justify-between inset-ring-1 px-2 text-left transition-colors",
                      showingSaved
                        ? "inset-ring-foreground bg-foreground text-background"
                        : "inset-ring-border/70 text-muted-foreground hover:bg-muted/35 hover:text-foreground",
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <IconBookmark className="size-4" />
                      Saved
                    </span>
                    <span>{bookmarks.length}</span>
                  </Button>
                </div>

                {customFeeds.length > 0 && (
                  <div>
                    <p className="mb-2 uppercase text-muted-foreground">
                      My feeds
                    </p>
                    <div className="space-y-1">
                      {customFeeds.map((feed) => (
                        <div
                          key={feed.slug}
                          className={cn(
                            "group flex h-12 items-stretch inset-ring-1 transition-colors",
                            !customUrl && selectedFeed === feed.slug
                              ? "inset-ring-foreground bg-muted text-foreground"
                              : "inset-ring-transparent text-muted-foreground hover:inset-ring-border/70 hover:text-foreground",
                          )}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => selectFeed(feed.slug)}
                            className="h-auto min-w-0 flex-1 flex-col items-start justify-center gap-0 border-0 px-2 text-left"
                          >
                            <span className="block w-full truncate">
                              {feed.name}
                            </span>
                            <span className="block w-full truncate uppercase text-muted-foreground/70">
                              {feedTags(feed).join(" / ")}
                            </span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void editCustomFeed(feed)}
                            title="Edit feed"
                            aria-label={`Edit ${feed.name}`}
                            className="h-auto w-8 border-0 text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          >
                            <IconPencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void deleteCustomFeed(feed)}
                            title="Remove feed"
                            aria-label={`Remove ${feed.name}`}
                            className="h-auto w-8 border-0 text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          >
                            <IconTrash className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {recent.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="uppercase text-muted-foreground">
                        Recent custom
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={clearRecent}
                        className="size-6 border-0 text-muted-foreground hover:text-foreground"
                      >
                        <IconTrash className="size-3" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {recent.map((entry) => (
                        <Button
                          key={entry.url}
                          type="button"
                          variant="ghost"
                          onClick={() => openRecent(entry)}
                          className="h-8 w-full justify-between gap-2 border-0 px-2 text-left text-muted-foreground hover:bg-muted/35 hover:text-foreground"
                        >
                          <span className="truncate">{entry.title}</span>
                          <span className="shrink-0">
                            {relativeTime(entry.visitedAt)}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-2 uppercase text-muted-foreground">
                    Directory
                  </p>
                  <div className="space-y-1">
                    {loadingFeeds ? (
                      <div className="flex items-center gap-2 px-2 py-2 text-muted-foreground">
                        <IconLoader2 className="size-4 animate-spin" />
                        Loading feeds...
                      </div>
                    ) : (
                      directoryFeeds.map((feed) => (
                        <Button
                          key={feed.slug}
                          type="button"
                          variant="ghost"
                          onClick={() => selectFeed(feed.slug)}
                          className={cn(
                            "flex h-12 w-full flex-col justify-center gap-0 inset-ring-1 px-2 text-left whitespace-normal transition-colors",
                            !customUrl && selectedFeed === feed.slug
                              ? "inset-ring-foreground bg-muted text-foreground"
                              : "inset-ring-transparent text-muted-foreground hover:inset-ring-border/70 hover:text-foreground",
                          )}
                        >
                          <span className="block w-full truncate">
                            {feed.name}
                          </span>
                          <span className="block w-full truncate uppercase text-muted-foreground/70">
                            {feedTags(feed).join(" / ")}
                          </span>
                        </Button>
                      ))
                    )}
                  </div>
                </div>

                {tags.length > 0 && (
                  <div>
                    <p className="mb-2 uppercase text-muted-foreground">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {tags.slice(0, 18).map((tag) => (
                        <span
                          key={tag.tag}
                          className="frame px-2 py-1 text-muted-foreground"
                        >
                          {tag.tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 rule-b p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  {showingSaved
                    ? "Saved"
                    : feedLabel(selectedFeedConfig, customUrl)}
                </p>
                <p className="truncate text-muted-foreground">
                  {showingSaved
                    ? "Items you starred"
                    : customUrl ||
                      selectedFeedConfig?.url ||
                      "Every feed, newest first"}
                </p>
              </div>
              <div className="relative min-w-48">
                <IconSearch className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter items"
                  className="pl-7"
                />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
              {loadingItems ? (
                <div className="flex items-center gap-2 py-16 text-muted-foreground">
                  <IconLoader2 className="size-4 animate-spin" />
                  Loading items...
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="flex items-center gap-2 frame px-3 py-16 text-muted-foreground">
                  <IconRss className="size-4 text-muted-foreground/50" />
                  Nothing here.
                </div>
              ) : (
                <div className="grid gap-4 [--col-gap:16px] xl:cols-2">
                  {filteredItems.map((item) => (
                    <article
                      key={item.itemKey || item.id}
                      className="group inset-ring-1 inset-ring-border/70 bg-background p-3 transition-colors hover:inset-ring-foreground/35 hover:bg-muted/20"
                    >
                      <div className="mb-2 flex h-6 items-center gap-2 text-muted-foreground">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <span className="truncate uppercase">
                            {item.feedName}
                          </span>
                          {itemTime(item) && (
                            <>
                              <span>/</span>
                              <IconClock className="size-3 shrink-0" />
                              <span className="shrink-0">{itemTime(item)}</span>
                            </>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void toggleBookmark(item)}
                          disabled={
                            bookmarkingItem === (item.itemKey || item.id)
                          }
                          aria-label={
                            bookmarkByItemKey.has(item.itemKey || item.id)
                              ? "Remove bookmark"
                              : "Bookmark RSS item"
                          }
                          title={
                            bookmarkByItemKey.has(item.itemKey || item.id)
                              ? "Remove bookmark"
                              : "Bookmark"
                          }
                          className={cn(
                            "size-6 shrink-0 border-0 text-muted-foreground opacity-80 transition-colors hover:bg-muted hover:text-foreground group-hover:opacity-100",
                            bookmarkByItemKey.has(item.itemKey || item.id) &&
                              "text-amber-300 opacity-100 hover:text-amber-300",
                          )}
                        >
                          <IconStar
                            className={cn(
                              "size-4",
                              bookmarkByItemKey.has(item.itemKey || item.id) &&
                                "fill-current",
                            )}
                          />
                        </Button>
                      </div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 text-foreground hover:underline"
                      >
                        {item.title || "Untitled"}
                      </a>
                      {item.summary && (
                        <p className="mt-2 line-clamp-3 text-muted-foreground">
                          {item.summary}
                        </p>
                      )}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {itemFeedTags(item)
                            .slice(0, 3)
                            .map((tag) => (
                              <span
                                key={tag}
                                className="frame px-2 py-1 text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                        </div>
                        <IconExternalLink className="size-4 shrink-0 text-muted-foreground/45 transition-colors group-hover:text-foreground" />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </ScrollArea>
          </section>
        </div>
      </div>
    </AppLayout>
  );
}
