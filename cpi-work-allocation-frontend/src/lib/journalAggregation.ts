import { distributePercentages } from "./allocationMath";
import {
  resolveSmartLines,
  type SmartLineInput,
} from "./timelineParser";
import { categoryTagBody } from "./tagHighlight";
import {
  isLeaveOrHolidayLog,
  leaveWorkTypeKey,
  isNonWorkingLogText,
} from "./leaveClassification";

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
  /**
   * True when at least one source entry carried an explicit @client tag
   * (even when the tag equals the fallback label, e.g. @Internal).
   * Used by formatAggregationAsPrompt to preserve the @tag in the generated
   * prompt so the user can see their intent reflected in the output.
   */
  explicitClient: boolean;
}

export interface AggregationOptions {
  /** Known client codes matched case-insensitively against untagged lines. */
  knownClients: readonly string[];
  /** Fallback client label when no @tag and no known-client match. */
  fallbackClient?: string;
  /**
   * Full taxonomy name list (main categories + sub categories). Used to
   * recognise multi-word `#category` tags — "TRAINING & DEVELOPMENT",
   * "Sales, Marketing & BD", "Quick Policy" — as a single token during
   * extraction. Without it, tag extraction degrades to single-word matching
   * (the pre-fix behaviour that truncated "#TRAINING & DEVELOPMENT" to
   * "#TRAINING"). Optional so tests / legacy call sites keep working.
   */
  knownCategories?: readonly string[];
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

// Client tag extractor: lookbehind prevents matching inside emails / glued
// tokens. Client codes are single tokens (@AFPGEN), so no multi-word handling
// is needed here — only #category tags fracture on spaces/ampersands.
const CLIENT_TAG_RE   = /(?<![A-Za-z0-9])@([A-Za-z][A-Za-z0-9_-]*)/;

/**
 * The set of regexes used to find and strip `#category` tags. Built from the
 * live taxonomy name list so a multi-word name (e.g. "TRAINING & DEVELOPMENT")
 * is captured whole instead of stopping at the first space or `&`. When no
 * category names are supplied the body degrades to the single-word form, so
 * behaviour is identical to the old hardcoded `#([A-Za-z][A-Za-z0-9_/-]*)`.
 *
 * All three share ONE body (categoryTagBody) so extraction, display-stripping
 * and dedup-stripping agree on exactly where a tag ends — the class of bug
 * that let "#TRAINING" and "& DEVELOPMENT …" split apart.
 */
export interface CategoryTagMatcher {
  /** Non-global, capturing — group 1 is the first tag body (without `#`). */
  extract: RegExp;
  /** Global — strips every full `#tag` plus a following run of whitespace. */
  stripWithSpace: RegExp;
  /** Global — strips every full `#tag`, leaving surrounding spacing intact. */
  strip: RegExp;
}

function buildCategoryMatcher(
  knownCategories: readonly string[] = [],
): CategoryTagMatcher {
  const body = categoryTagBody(knownCategories);
  return {
    extract: new RegExp(`(?<![A-Za-z0-9])#(${body})`),
    stripWithSpace: new RegExp(`(?<![A-Za-z0-9])#${body}\\s*`, "g"),
    strip: new RegExp(`(?<![A-Za-z0-9])#${body}`, "g"),
  };
}

/**
 * Single-word default matcher, used when a caller doesn't supply the taxonomy
 * name list (tests, legacy). Preserves the pre-fix single-token behaviour.
 */
const DEFAULT_CATEGORY_MATCHER = buildCategoryMatcher();

/**
 * Epic 1 — Robust whitespace normalization.
 *
 * Collapse every run of whitespace (multiple spaces, tabs, stray newlines)
 * down to a single space and strip the leading/trailing edges. This is the
 * `normalizedLog` step: it runs on every parsed activity line BEFORE the
 * consolidation/dedup so that logs differing only by internal spacing —
 * "#Geniisys Support" vs. "#Geniisys  Support" — collapse to the SAME
 * bucket / dedup key instead of fracturing into separate allocations
 * (the "#Geniisys Support - 3.33%" multi-line symptom).
 *
 * Case-insensitivity is handled at the dedup-key layer (`.toLowerCase()`);
 * this helper only normalizes spacing so the original casing survives for
 * display.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Epic 1 — canonical key for bullet de-duplication within a bucket.
 *
 * Strips @client / #category tags, collapses whitespace, and lowercases so
 * that bullets describing the SAME work collapse to a single entry regardless
 * of cosmetic differences:
 *   - internal spacing        ("#Geniisys Support"  vs "#Geniisys  Support")
 *   - letter case             ("Support" vs "support" vs "SUpport")
 *   - tag presence / ordering ("#Geniisys Support @AUII" vs "@AUII support #Geniisys")
 *
 * The tags are NOT lost: they're captured at the unit level (clientTags /
 * categoryTag) and drive the bucket's client + category. For the purpose of
 * comparing two bullet strings inside one bucket, the per-bullet tag text is
 * pure noise — including it in the key is exactly what let "Support" and
 * "support" survive as separate bullets on the same card.
 */
function bulletDedupKey(
  text: string,
  cat: CategoryTagMatcher = DEFAULT_CATEGORY_MATCHER,
): string {
  return normalizeWhitespace(
    text
      .replace(/(?<![A-Za-z0-9])@[A-Za-z][A-Za-z0-9_-]*/g, "")
      .replace(cat.strip, ""),
  ).toLowerCase();
}

/**
 * Epic 2 — Case-insensitive, whitespace-resistant "Specific Enhancement"
 * detector. The `\s*` between the two words matches zero-or-more spaces, so
 * "Specific Enhancement", "specific   enhancement" and the glued
 * "SpecificEnhancement" all match. Any log line matching this is treated as
 * a UNIQUE piece of work and is never merged into a shared client/category
 * block (see aggregateJournalEntries).
 */
const SPECIFIC_ENHANCEMENT_RE = /specific\s*enhancement/i;

/**
 * Epic 2 — the fixed taxonomy path every "Specific Enhancement" log is
 * routed to: Projects → Geniisys → Specific Enhancement. Only the
 * sub-category is stored on the bucket (emitted as `#Geniisys`); the parser
 * resolves the main category and the work type downstream.
 */
const SPECIFIC_ENHANCEMENT_SUBCATEGORY = "Geniisys";

// Bullet / list markers: -, --, •, *, 1., 2), etc.
const LIST_MARKER_RE = /^(?:[-–•*]+|\d+[.)])\s*/;

/** Hierarchical block header: non-bullet line ending with `:` */
const HIERARCHICAL_HEADER_RE = /^([^-•*].+?):\s*$/;
/** Hierarchical bullet continuation: requires 2+ dashes or •/* */
const HIERARCHICAL_BULLET_RE = /^(?:[-–]{2,}|[•*])\s/;

type LineUnit = {
  bullets: string[];
  /** All @client tags found in this unit (original casing). Empty when none. */
  clientTags: string[];
  categoryTag?: string;
};

/** Duration in minutes between two HH:MM strings. Returns 0 for invalid/reversed ranges.
 *  "00:00" as end is treated as 1440 (24:00, end-of-day) when start is after midnight,
 *  matching the endMinutes() logic in timelineParser so midnight end-times produce
 *  the correct duration instead of 0.
 */
function calcMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startTotal = sh * 60 + sm;
  const endTotal = eh * 60 + em;
  const effectiveEnd = endTotal === 0 && startTotal > 0 ? 1440 : endTotal;
  return Math.max(0, effectiveEnd - startTotal);
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
function descriptionToUnit(
  description: string,
  cat: CategoryTagMatcher = DEFAULT_CATEGORY_MATCHER,
): LineUnit {
  const rawLines = description
    .split("\n")
    // Epic 1: strip the bullet marker, then normalize internal whitespace so
    // spacing variants dedupe cleanly downstream.
    .map((l) => normalizeWhitespace(l.replace(LIST_MARKER_RE, "")))
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { bullets: [], clientTags: [], categoryTag: undefined };
  }

  // Extract tags from the combined text so a header like "@AAA:" still
  // contributes its tag even when we drop the header from bullets. The
  // category matcher captures multi-word names whole (e.g. the full
  // "TRAINING & DEVELOPMENT", not just "TRAINING").
  const combined = rawLines.join(" ");
  const clientTags = [
    ...combined.matchAll(new RegExp(CLIENT_TAG_RE.source, "g")),
  ].map((m) => m[1]);
  const categoryTag = combined.match(cat.extract)?.[1];

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
      .replace(cat.strip, "")
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
function parseEntryIntoUnits(
  content: string,
  cat: CategoryTagMatcher = DEFAULT_CATEGORY_MATCHER,
): LineUnit[] {
  // Epic 1: normalize each line's internal whitespace up front so every
  // downstream comparison (header detection, bullet dedup) sees canonical
  // single-spaced text.
  const lines = content.split("\n").map((l) => normalizeWhitespace(l));
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
      const headerText = normalizeWhitespace(headerMatch[1]);
      const subBullets: string[] = [];
      let j = i + 1;

      while (j < lines.length) {
        const bLine = lines[j];
        if (!bLine) {
          j++;
          continue;
        }
        if (!HIERARCHICAL_BULLET_RE.test(bLine)) break;
        subBullets.push(normalizeWhitespace(bLine.replace(LIST_MARKER_RE, "")));
        j++;
      }

      if (subBullets.length > 0) {
        const combined = `${headerText} ${subBullets.join(" ")}`;
        const clientTags = [...combined.matchAll(new RegExp(CLIENT_TAG_RE.source, "g"))].map(m => m[1]);
        const categoryTag = combined.match(cat.extract)?.[1];
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
    const bullet = normalizeWhitespace(line.replace(LIST_MARKER_RE, ""));
    if (bullet) {
      const clientTags = [...bullet.matchAll(new RegExp(CLIENT_TAG_RE.source, "g"))].map(m => m[1]);
      const categoryTag = bullet.match(cat.extract)?.[1];
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
  const { knownClients, fallbackClient = "Internal", knownCategories = [] } = options;
  const clientFallbackRe = knownClients.length
    ? new RegExp(`\\b(${knownClients.join("|")})\\b`, "i")
    : null;

  // Epic 1: one multi-word-aware category matcher for the whole pass, so a tag
  // like "#TRAINING & DEVELOPMENT" is captured/stripped as a single token
  // instead of fracturing into "#TRAINING" + "& DEVELOPMENT …".
  const cat = buildCategoryMatcher(knownCategories);

  const resolveClients = (unit: LineUnit): string[] => {
    if (unit.clientTags.length > 0) return unit.clientTags;
    if (clientFallbackRe) {
      for (const b of unit.bullets) {
        const m = b.match(clientFallbackRe);
        if (m) {
          const canonical = knownClients.find(c => c.toLowerCase() === m[1].toLowerCase()) ?? m[1];
          return [canonical];
        }
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
    /** Set to true if any contributing unit carried an explicit @client tag. */
    explicitClient: boolean;
  };
  const buckets = new Map<string, Bucket>();

  // Epic 2: monotonic counter used to mint a UNIQUE bucket key for every
  // "Specific Enhancement" unit so they never collapse into one another or
  // into a shared client/category block. Incremented once per isolated card.
  let specificEnhancementSeq = 0;

  /**
   * Epic 2 — resolve the bucket key + effective category for one work unit.
   *
   * Normal units bucket by `${client}::${category}` so identical work across
   * days consolidates. A unit whose text matches SPECIFIC_ENHANCEMENT_RE is
   * force-routed to sub-category "Geniisys" AND given a globally-unique key,
   * guaranteeing it renders as its own standalone allocation card while still
   * preserving its @client hook (the key is still client-scoped).
   *
   * Leave / holiday units bucket by their DETECTED Work Type (case-
   * insensitive) rather than by category. Untagged leaves would otherwise all
   * collapse into the one `__untagged__` bucket, consolidating "Sick Leave"
   * and "Vacation Leave" into a single card. Keying on the leave type keeps
   * distinct types in separate cards while still merging case variants
   * ("sick leave" / "Sick Leave" / "SICK LEAVE").
   */
  const resolveBucket = (
    client: string,
    unit: LineUnit,
  ): { key: string; category?: string } => {
    const isSpecificEnhancement = unit.bullets.some((b) =>
      SPECIFIC_ENHANCEMENT_RE.test(b),
    );
    if (isSpecificEnhancement) {
      return {
        key: `__specific_enhancement__::${specificEnhancementSeq++}::${client}`,
        category: SPECIFIC_ENHANCEMENT_SUBCATEGORY,
      };
    }
    // UNREACHABLE as of the non-working-time exclusion: `isNonWorkingUnit`
    // drops every leave/holiday unit before resolveBucket is reached. Kept
    // deliberately — it documents how leave USED to bucket and is the branch
    // to restore if leave ever becomes costed work again. Do not "fix" it by
    // re-routing leave here; the exclusion gate is the intended behaviour.
    //
    // Untagged leaves have no category, so they'd all share one bucket. Split
    // by detected leave type so distinct types don't consolidate. An untagged
    // leave (e.g. "on leave") with no specific type still shares one bucket.
    const unitText = unit.bullets.join(" ");
    if (!unit.categoryTag && isLeaveOrHolidayLog(unitText)) {
      const typeKey = leaveWorkTypeKey(unitText) ?? "__unclassified__";
      return { key: `${client}::__leave__::${typeKey}` };
    }
    const category = unit.categoryTag;
    return { key: `${client}::${category ?? "__untagged__"}`, category };
  };

  /**
   * Non-working-time gate. Leave / holiday units are dropped from the
   * aggregation entirely: their minutes must not enter `totalMinutes`
   * (which weights every percentage) and their bullets must not reach
   * `formatAggregationAsPrompt` (which builds the review summary).
   *
   * The raw JournalEntry rows are untouched — the log stays in the DB,
   * it just stops participating in allocation math.
   */
  const isNonWorkingUnit = (unit: LineUnit): boolean =>
    isNonWorkingLogText(unit.bullets.join(" "));

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

        const unit = descriptionToUnit(description, cat);
        if (unit.bullets.length === 0) continue;
        if (isNonWorkingUnit(unit)) continue; // leave/holiday: excluded from math

        const clients = resolveClients(unit);
        const isExplicit = unit.clientTags.length > 0;
        const minutes = calcMinutes(block.startTime, block.endTime);
        // Divide block duration equally when the line mentions multiple clients.
        const minutesEach = clients.length > 1 ? minutes / clients.length : minutes;

        for (const client of clients) {
          // Epic 2: Specific Enhancement units get a unique, isolated bucket
          // (never consolidated); everything else buckets by client+category.
          const { key, category } = resolveBucket(client, unit);
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { client, category, bullets: [], days: new Set(), seenBullets: new Set(), totalMinutes: 0, explicitClient: false };
            buckets.set(key, bucket);
          }
          if (isExplicit) bucket.explicitClient = true;

          if (minutesEach > 0) bucket.totalMinutes += minutesEach;
          bucket.days.add(entry.date);

          for (const raw of unit.bullets) {
            // Epic 1: compare on a tag-/case-/spacing-insensitive key so
            // "#Geniisys Support @AUII" and "@AUII support #Geniisys" collapse
            // to one bullet instead of fracturing the card.
            const norm = bulletDedupKey(raw, cat);
            if (!norm || bucket.seenBullets.has(norm)) continue;
            bucket.seenBullets.add(norm);
            bucket.bullets.push(normalizeWhitespace(raw));
          }
        }
      }
    } else {
      // ── Legacy content entry: parse bullet lines ──────────────────────
      const units = parseEntryIntoUnits(entry.content, cat);

      for (const unit of units) {
        if (isNonWorkingUnit(unit)) continue; // leave/holiday: excluded from math
        const clients = resolveClients(unit);
        const isExplicit = unit.clientTags.length > 0;
        // Divide the 8h fallback equally when the line mentions multiple clients.
        const minutesPerClient = 480 / clients.length;

        for (const client of clients) {
          // Epic 2: Specific Enhancement units get a unique, isolated bucket
          // (never consolidated); everything else buckets by client+category.
          const { key, category } = resolveBucket(client, unit);
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { client, category, bullets: [], days: new Set(), seenBullets: new Set(), totalMinutes: 0, explicitClient: false };
            buckets.set(key, bucket);
          }
          if (isExplicit) bucket.explicitClient = true;

          // Each new distinct day this bucket appears on contributes its share of 8h.
          if (!bucket.days.has(entry.date)) {
            bucket.totalMinutes += minutesPerClient;
          }
          bucket.days.add(entry.date);

          for (const raw of unit.bullets) {
            // Epic 1: compare on a tag-/case-/spacing-insensitive key so
            // "#Geniisys Support @AUII" and "@AUII support #Geniisys" collapse
            // to one bullet instead of fracturing the card.
            const norm = bulletDedupKey(raw, cat);
            if (!norm || bucket.seenBullets.has(norm)) continue;
            bucket.seenBullets.add(norm);
            bucket.bullets.push(normalizeWhitespace(raw));
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
    explicitClient: b.explicitClient,
  }));
}

// ---------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------

export interface FormatOptions {
  fallbackClient?: string;
  /**
   * Full taxonomy name list — same purpose as in AggregationOptions. Needed so
   * stripTags removes a multi-word `#category` tag whole when cleaning the
   * bullet text for display (otherwise "#TRAINING & DEVELOPMENT 2nd COC…"
   * strips to "& DEVELOPMENT 2nd COC…"). Optional; degrades to single-word.
   */
  knownCategories?: readonly string[];
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
  const { fallbackClient = "Internal", knownCategories = [] } = options;
  const cat = buildCategoryMatcher(knownCategories);

  const sorted = [...items].sort((a, b) => b.pct - a.pct);

  return sorted
    .map((item) => {
      const tagBits: string[] = [];
      if (item.client !== fallbackClient || item.explicitClient) tagBits.push(`@${item.client}`);
      if (item.category) tagBits.push(`#${item.category}`);
      const tagPrefix = tagBits.length ? `${tagBits.join(" ")} ` : "";

      if (item.bullets.length === 1) {
        const bulletText = stripTags(item.bullets[0], cat);
        return `- ${tagPrefix}${bulletText} - ${item.pct.toFixed(2)}%`;
      }

      // When the bucket has tags, the tags ARE the header context — don't
      // append a bare "Work" placeholder (it leaks into the card's leading
      // description line / title once the parser preserves the header). Fall
      // back to the client name, then "Work", only when there are no tags.
      const header = tagBits.length
        ? `${tagBits.join(" ")}:`
        : `${item.client || "Work"}:`;
      const bulletLines = item.bullets.map((b, idx) => {
        const text = stripTags(b, cat);
        const suffix =
          idx === item.bullets.length - 1 ? ` - ${item.pct.toFixed(2)}%` : "";
        return `-- ${text}${suffix}`;
      });
      return [header, ...bulletLines].join("\n");
    })
    .join("\n\n");
}

/**
 * Strip any `@client` or `#category` tags from a bullet text. The category
 * matcher removes a multi-word tag whole (e.g. the entire
 * "#TRAINING & DEVELOPMENT", not just "#TRAINING"), so the remaining text
 * starts cleanly at the real task ("2nd COC: Cybersecurity …").
 */
function stripTags(
  text: string,
  cat: CategoryTagMatcher = DEFAULT_CATEGORY_MATCHER,
): string {
  return text
    .replace(/(?<![A-Za-z0-9])@[A-Za-z][A-Za-z0-9_-]*\s*/g, "")
    .replace(cat.stripWithSpace, "")
    .replace(/\s+/g, " ")
    .trim();
}
