import { distributePercentages } from "./allocationMath";
import {
  resolveSmartLines,
  type SmartLineInput,
} from "./timelineParser";

/**
 * Journal aggregation — consolidates a month of journal entries into
 * work-allocation cards.
 *
 * Percentage weighting strategy:
 *   - Entries with time blocks: weighted by total minutes logged per
 *     (client, category) bucket. A bucket with 4h of logged blocks gets
 *     2× the weight of one with 2h, giving exact hour-based percentages.
 *   - Legacy entries (no blocks): each distinct day the bucket appeared
 *     contributes 480 minutes (8h fallback), preserving the old day-count
 *     proportions while staying on the same minutes scale.
 *
 * Example: 160h total in a month, 40h tagged to @Geniisys → 25.00% exactly.
 */

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export interface TimeBlock {
  id: string;
  startTime: string; // "HH:MM" 24-hour
  endTime: string;   // "HH:MM" 24-hour
  description: string;
}

export interface JournalEntry {
  date: string;     // "YYYY-MM-DD"
  content: string;
  blocks?: TimeBlock[];
}

export interface AggregatedTask {
  client: string;
  category?: string;
  /** Deduplicated bullets across all days in date order. */
  bullets: string[];
  /** Distinct dates where this bucket appeared. */
  days: string[];
  /** 2dp percentage of the month. */
  pct: number;
}

export interface AggregationOptions {
  /** Known client codes matched case-insensitively against untagged lines. */
  knownClients: readonly string[];
  /** Fallback client label when no @tag and no known-client match. */
  fallbackClient?: string;
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

// Tag extractors: lookbehind prevents matching inside emails / glued tokens.
const CLIENT_TAG_RE   = /(?<![A-Za-z0-9])@([A-Za-z][A-Za-z0-9_-]*)/;
const CATEGORY_TAG_RE = /(?<![A-Za-z0-9])#([A-Za-z][A-Za-z0-9_/-]*)/;

// Bullet / list markers: -, --, •, *, 1., 2), etc.
const LIST_MARKER_RE = /^(?:[-–•*]+|\d+[.)])\s*/;

/** Hierarchical block header: non-bullet line ending with `:` */
const HIERARCHICAL_HEADER_RE = /^([^-•*].+?):\s*$/;
/** Hierarchical bullet continuation: requires 2+ dashes or •/* */
const HIERARCHICAL_BULLET_RE = /^(?:[-–]{2,}|[•*])\s/;

type LineUnit = {
  bullets: string[];
  /** All @client tags found in this unit, uppercased. Empty when none. */
  clientTags: string[];
  categoryTag?: string;
};

/** Duration in minutes between two HH:MM strings. Returns 0 for invalid/reversed ranges. */
function calcMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

/**
 * Parse a description string into a LineUnit (used for time-block entries).
 *
 * Multi-line descriptions (e.g. `@AAA:\n - IP Whitelisting\n - Resolving …`)
 * are split into one bullet per line so the aggregator preserves every
 * bullet rather than collapsing the whole entry into a single squashed
 * bullet (which `stripTags` would then flatten to a single line via
 * `\s+` → space). Tags are still extracted from the combined text.
 *
 * Single-line descriptions stay a single bullet — original behavior.
 */
function descriptionToUnit(description: string): LineUnit {
  const rawLines = description
    .split("\n")
    .map((l) => l.replace(LIST_MARKER_RE, "").trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { bullets: [], clientTags: [], categoryTag: undefined };
  }

  // Extract tags from the combined text so a header like "@AAA:" still
  // contributes its tag even when we drop the header from bullets.
  const combined = rawLines.join(" ");
  const clientTags = [
    ...combined.matchAll(new RegExp(CLIENT_TAG_RE.source, "g")),
  ].map((m) => m[1].toUpperCase());
  const categoryTag = combined.match(CATEGORY_TAG_RE)?.[1];

  // When the first line is a bare annotation header — only tags and a
  // trailing colon, no actual work text — drop it from bullets. Without
  // this the bullet list starts with "@AAA:" which `stripTags` (called
  // by formatAggregationAsPrompt) collapses to just ":".
  //
  // Only drop the header when at least one real bullet follows; a
  // single-line description like "@AUII follow-up" must keep its line.
  let bullets = rawLines;
  if (rawLines.length > 1) {
    const stripped = rawLines[0]
      .replace(/(?<![A-Za-z0-9])@[A-Za-z][A-Za-z0-9_-]*/g, "")
      .replace(/(?<![A-Za-z0-9])#[A-Za-z][A-Za-z0-9_/-]*/g, "")
      .replace(/[:\s]+/g, "")
      .trim();
    if (stripped === "") {
      bullets = rawLines.slice(1);
    }
  }

  return {
    bullets,
    clientTags,
    categoryTag,
  };
}

/**
 * Parse one day's journal content into semantic units.
 *
 * A unit is either:
 *   - a hierarchical block: Header line + its -- bullets → one unit
 *     with the header as its first bullet and the sub-bullets as
 *     additional bullets
 *   - a standalone line → one unit with one bullet
 *
 * Blank lines are ignored. Tags are extracted but left in the bullet
 * text so the user sees them in the prompt for inspection.
 */
function parseEntryIntoUnits(content: string): LineUnit[] {
  const lines = content.split("\n").map((l) => l.trim());
  const units: LineUnit[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    // Hierarchical block: Header: followed by -- bullets
    const headerMatch = line.match(HIERARCHICAL_HEADER_RE);
    if (headerMatch && i + 1 < lines.length) {
      const headerText = headerMatch[1].trim();
      const subBullets: string[] = [];
      let j = i + 1;

      while (j < lines.length) {
        const bLine = lines[j];
        if (!bLine) {
          j++;
          continue;
        }
        if (!HIERARCHICAL_BULLET_RE.test(bLine)) break;
        subBullets.push(bLine.replace(LIST_MARKER_RE, "").trim());
        j++;
      }

      if (subBullets.length > 0) {
        const combined = `${headerText} ${subBullets.join(" ")}`;
        const clientTags = [...combined.matchAll(new RegExp(CLIENT_TAG_RE.source, "g"))].map(m => m[1].toUpperCase());
        const categoryTag = combined.match(CATEGORY_TAG_RE)?.[1];
        units.push({
          bullets: [headerText, ...subBullets],
          clientTags,
          categoryTag,
        });
        i = j;
        continue;
      }
    }

    // Standalone line
    const bullet = line.replace(LIST_MARKER_RE, "").trim();
    if (bullet) {
      const clientTags = [...bullet.matchAll(new RegExp(CLIENT_TAG_RE.source, "g"))].map(m => m[1].toUpperCase());
      const categoryTag = bullet.match(CATEGORY_TAG_RE)?.[1];
      units.push({
        bullets: [bullet],
        clientTags,
        categoryTag,
      });
    }
    i++;
  }

  return units;
}

// ---------------------------------------------------------------------
// Block derivation from raw content
// ---------------------------------------------------------------------

/**
 * Derive TimeBlock[] from an entry's raw content string.
 *
 * Why we re-derive instead of trusting `entry.blocks`:
 *   The stored `entry.blocks` payload was written by the DailyJournal
 *   editor at save time. Older saves (before continuation-line grouping
 *   was added) only stored the first line of a multi-line entry as the
 *   block description — so `@AAA:\n - IP Whitelisting\n - …` was
 *   persisted as a block with description `"@AAA:"`, and the bullets
 *   were silently lost from aggregation.
 *
 *   Re-deriving from `entry.content` (which always preserves the raw
 *   typed text) produces the same blocks the editor would save today,
 *   with continuation lines correctly attached. The aggregator becomes
 *   immune to stale stored blocks.
 *
 * Grouping rules mirror DailyJournal.derivedBlocks:
 *   - A line with a time range OR leading time opens a new block.
 *   - A leading-time-only line (clock-out marker) breaks the chain.
 *   - A line with no time info attaches to the open block's description
 *     with a `\n` separator.
 *
 * Returns [] when the content contains no time-bearing lines — the
 * caller falls back to the legacy `parseEntryIntoUnits` path for
 * timeless bullet-list entries.
 */
export function deriveBlocksFromContent(content: string): TimeBlock[] {
  const lines: SmartLineInput[] = content
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => ({ id: `derive-${i}`, text: l }));

  if (lines.length === 0) return [];

  const resolved = resolveSmartLines(lines);
  const blocks: TimeBlock[] = [];
  let current: TimeBlock | null = null;

  for (const l of resolved) {
    const hasTime = !!(l.leadingTime || l.timeRange);

    if (hasTime && !l.isTimeOnly && l.startTime && l.endTime) {
      let description = l.text;
      if (l.leadingTime) {
        description = l.text
          .substring(l.leadingTime.index + l.leadingTime.length)
          .trim();
      } else if (l.timeRange) {
        description = l.text.substring(l.timeRange.spanEnd).trim();
      }
      current = {
        id: l.id,
        startTime: l.startTime,
        endTime: l.endTime,
        description,
      };
      blocks.push(current);
      continue;
    }

    if (l.isTimeOnly) {
      current = null;
      continue;
    }

    if (!hasTime && current && l.text.trim()) {
      current.description = current.description
        ? `${current.description}\n${l.text.trim()}`
        : l.text.trim();
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------

/**
 * Aggregate entries into consolidated task buckets by (client, category).
 *
 * Percentages are weighted by total minutes:
 *   - Time-blocked entries contribute actual block durations.
 *   - Legacy (content-only) entries contribute 480 min per distinct day
 *     the bucket appeared, preserving proportional correctness.
 *
 * Percentages sum to exactly 100.00 via largest-remainder distribution.
 * Returns [] when no parseable units were found.
 */
export function aggregateJournalEntries(
  entries: readonly JournalEntry[],
  options: AggregationOptions,
): AggregatedTask[] {
  const { knownClients, fallbackClient = "Internal" } = options;
  const clientFallbackRe = knownClients.length
    ? new RegExp(`\\b(${knownClients.join("|")})\\b`, "i")
    : null;

  const resolveClients = (unit: LineUnit): string[] => {
    if (unit.clientTags.length > 0) return unit.clientTags;
    if (clientFallbackRe) {
      for (const b of unit.bullets) {
        const m = b.match(clientFallbackRe);
        if (m) return [m[1].toUpperCase()];
      }
    }
    return [fallbackClient];
  };

  type Bucket = {
    client: string;
    category?: string;
    bullets: string[];
    days: Set<string>;
    seenBullets: Set<string>;
    /** Accumulated minutes — actual block durations or 480/day for legacy entries. */
    totalMinutes: number;
  };
  const buckets = new Map<string, Bucket>();

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  for (const entry of sorted) {
    // Re-derive blocks from content so stale stored `entry.blocks`
    // (saved before continuation-line grouping landed) don't truncate
    // the aggregation. Falls back to stored blocks only when nothing
    // can be derived — purely defensive; in practice every time-bearing
    // entry round-trips identically.
    const derivedBlocks = deriveBlocksFromContent(entry.content);
    const effectiveBlocks =
      derivedBlocks.length > 0
        ? derivedBlocks
        : entry.blocks && entry.blocks.length > 0
        ? entry.blocks
        : [];

    if (effectiveBlocks.length > 0) {
      // ── Time-blocked entry: each block is one work unit ──────────────
      for (const block of effectiveBlocks) {
        const description = block.description.trim();
        if (!description) continue;

        const unit = descriptionToUnit(description);
        if (unit.bullets.length === 0) continue;

        const clients = resolveClients(unit);
        const category = unit.categoryTag;
        const minutes = calcMinutes(block.startTime, block.endTime);
        // Divide block duration equally when the line mentions multiple clients.
        const minutesEach = clients.length > 1 ? minutes / clients.length : minutes;

        for (const client of clients) {
          const key = `${client}::${category ?? "__untagged__"}`;
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { client, category, bullets: [], days: new Set(), seenBullets: new Set(), totalMinutes: 0 };
            buckets.set(key, bucket);
          }

          if (minutesEach > 0) bucket.totalMinutes += minutesEach;
          bucket.days.add(entry.date);

          for (const raw of unit.bullets) {
            const norm = raw.toLowerCase().trim();
            if (!norm || bucket.seenBullets.has(norm)) continue;
            bucket.seenBullets.add(norm);
            bucket.bullets.push(raw);
          }
        }
      }
    } else {
      // ── Legacy content entry: parse bullet lines ──────────────────────
      const units = parseEntryIntoUnits(entry.content);

      for (const unit of units) {
        const clients = resolveClients(unit);
        const category = unit.categoryTag;
        // Divide the 8h fallback equally when the line mentions multiple clients.
        const minutesPerClient = 480 / clients.length;

        for (const client of clients) {
          const key = `${client}::${category ?? "__untagged__"}`;
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { client, category, bullets: [], days: new Set(), seenBullets: new Set(), totalMinutes: 0 };
            buckets.set(key, bucket);
          }

          // Each new distinct day this bucket appears on contributes its share of 8h.
          if (!bucket.days.has(entry.date)) {
            bucket.totalMinutes += minutesPerClient;
          }
          bucket.days.add(entry.date);

          for (const raw of unit.bullets) {
            const norm = raw.toLowerCase().trim();
            if (!norm || bucket.seenBullets.has(norm)) continue;
            bucket.seenBullets.add(norm);
            bucket.bullets.push(raw);
          }
        }
      }
    }
  }

  const items = Array.from(buckets.values());
  if (items.length === 0) return [];

  // Weight by actual minutes logged. Fall back to 1 so 0-minute edge
  // cases don't crash distributePercentages.
  const weights = items.map((b) => Math.max(b.totalMinutes, 1));
  const percentages = distributePercentages(weights);

  return items.map((b, i) => ({
    client: b.client,
    category: b.category,
    bullets: b.bullets,
    days: Array.from(b.days).sort(),
    pct: percentages[i],
  }));
}

// ---------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------

export interface FormatOptions {
  fallbackClient?: string;
}

/**
 * Format aggregated tasks into the prompt text that the user reviews
 * before card generation.
 *
 * Emit rules:
 *   - Multi-bullet bucket → hierarchical block. Header carries the
 *     @client and #category tags. Last bullet carries the percentage
 *     (parser sums the block's percentage from trailing-% on bullets).
 *   - Single-bullet bucket → flat simple format (`- text - XX%`).
 *
 * Sort order: highest percentage first.
 */
export function formatAggregationAsPrompt(
  items: readonly AggregatedTask[],
  options: FormatOptions = {},
): string {
  const { fallbackClient = "Internal" } = options;

  const sorted = [...items].sort((a, b) => b.pct - a.pct);

  return sorted
    .map((item) => {
      const tagBits: string[] = [];
      if (item.client !== fallbackClient) tagBits.push(`@${item.client}`);
      if (item.category) tagBits.push(`#${item.category}`);
      const tagPrefix = tagBits.length ? `${tagBits.join(" ")} ` : "";

      if (item.bullets.length === 1) {
        const bulletText = stripTags(item.bullets[0]);
        return `- ${tagPrefix}${bulletText} - ${item.pct.toFixed(2)}%`;
      }

      const headerLabel = tagBits.length ? "Work" : (item.client || "Work");
      const header = `${tagPrefix}${headerLabel}:`;
      const bulletLines = item.bullets.map((b, idx) => {
        const text = stripTags(b);
        const suffix =
          idx === item.bullets.length - 1 ? ` - ${item.pct.toFixed(2)}%` : "";
        return `-- ${text}${suffix}`;
      });
      return [header, ...bulletLines].join("\n");
    })
    .join("\n\n");
}

/**
 * Strip any `@client` or `#category` tags from a bullet text.
 */
function stripTags(text: string): string {
  return text
    .replace(/(?<![A-Za-z0-9])@[A-Za-z][A-Za-z0-9_-]*\s*/g, "")
    .replace(/(?<![A-Za-z0-9])#[A-Za-z][A-Za-z0-9_/-]*\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
