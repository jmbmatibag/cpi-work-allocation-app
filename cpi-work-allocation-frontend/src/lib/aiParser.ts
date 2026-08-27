/**
 * AI-backed parser for work allocation descriptions.
 *
 * Replaces the rule-based parser's inference logic with a Claude API
 * call. The rule parser (`src/lib/promptParser.ts`) remains available
 * as the fallback path for when no API key is configured or the API
 * call fails.
 *
 * Design decisions:
 *
 * - Percentage extraction stays deterministic (regex on input text).
 *   The LLM is used only for classification — category, sub category,
 *   work type, client. This avoids hallucinated percentages and lets
 *   the same regex tests apply.
 *
 * - Batch API calls. A single Auto-Generate parse sends all bullets
 *   in one API call with IDs, not N separate calls. One round-trip
 *   to classify 20 bullets is ~1.5s; twenty round-trips would be 30s.
 *
 * - JSON-only response contract. We ask the model to return a JSON
 *   array and nothing else. Response is parsed with JSON.parse after
 *   stripping any accidental ```json fences.
 *
 * - Security: API key is passed in, never hardcoded. The calling
 *   context (AdminSettings) reads it from localStorage. This module
 *   has no side effects; it's pure request/response.
 *
 * - Browser-direct API call. Uses `anthropic-dangerous-direct-browser-
 *   access: true` header. See SECURITY NOTE in aiConfig.ts.
 */

import type { ParsedTask, TaxonomySnapshot, InferenceRule } from "@/lib/promptParser";
import {
  parseWorkAllocation,
  applyEnhancementTags,
  LEGACY_TAG_HINTS,
  filterOfficialClients,
} from "@/lib/promptParser";
import type { SubCategory, WorkType } from "@/contexts/ClientsConfigContext";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export interface AIParseOptions {
  /** Anthropic API key. If empty/undefined, falls back to rule parser. */
  apiKey: string | null | undefined;
  /** Which Claude model to use. Haiku is fast + cheap; Sonnet more accurate. */
  model?: string;
  /** Default team name for the ParsedTask (required, same as rule parser). */
  defaultTeam: string;
  /** Known clients. Passed to the model so it knows valid client codes. */
  knownClients: readonly string[];
  /** Fallback client when none detected. Default: "Internal". */
  fallbackClient?: string;
  /** Full taxonomy: main categories + sub categories + work types. */
  mainCategories: readonly string[];
  subCategories: readonly SubCategory[];
  workTypes: readonly WorkType[];
  /** Live taxonomy snapshot (for rule-parser fallback). */
  taxonomy: TaxonomySnapshot;
  /**
   * Live inference rules from the DB (ClientsConfigContext). REQUIRED for the
   * rule-parser fallback to detect custom work types (DevOps Management,
   * Debugging, etc.). Without this, parseWorkAllocation falls back to the
   * hardcoded DEFAULT_INFERENCE_RULES, which only know the seed work types —
   * so tagged cards for custom work types come back blank.
   */
  inferenceRules?: readonly InferenceRule[];
  /**
   * Live Enhancement roster. Drives the `$Name` token: the AI path and the
   * rule path both get the same treatment, so a tag typed in the prompt box
   * lands on the card regardless of which parser produced it.
   */
  enhancementTags?: readonly string[];
  /**
   * When true, skips the API call and uses the rule parser directly.
   * Used for testing and for explicit user opt-out.
   */
  forceRuleFallback?: boolean;
  /**
   * Called with 'ai' when the AI parser succeeded, 'rules' when the
   * rule parser was used as fallback. UI uses this to show a small
   * badge on AI-generated cards.
   */
  onPathSelected?: (path: "ai" | "rules") => void;
}

export interface AIParseResult {
  tasks: ParsedTask[];
  /** Which parsing path produced these tasks. UI can show a badge. */
  source: "ai" | "rules";
  /** Present when source='rules' and the fallback was triggered by an error. */
  aiErrorMessage?: string;
}

// ---------------------------------------------------------------------
// Default model — Haiku is plenty for classification and much cheaper
// ---------------------------------------------------------------------

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// =====================================================================
// Dynamic allocation parser — hour-based natural language inputs
// =====================================================================
//
// Handles 5 scenarios where the user writes hours instead of percentages.
// This pre-pass runs BEFORE the AI/rule path so that hour-based lines
// are resolved deterministically without an API call.
//
// Conversion: percentage = (hours / WORKDAY_HOURS) × 100
// No rounding is applied at this stage — exact float precision is
// preserved so that downstream math (e.g. 4h / 3 clients = 16.666...%)
// remains accurate.

/**
 * Standard workday hours for percentage conversion.
 * 4 hours out of an 8-hour day = 50%.
 */
const WORKDAY_HOURS = 8;

// Hours value anywhere in a string: "4 hours", "3 hrs", "2.5 hr", "1.5 hours".
// Capture group 1 = the numeric part (may include decimal).
// The `g` flag is intentional — we use this in matchAll() calls.
const HOURS_VALUE_RE = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/gi;

// Detects the "each client" or "per client" phrase that signals Scenario E —
// the hours value applies individually to EVERY project client, not divided.
const EACH_CLIENT_RE = /\b(?:each|per)\s+client\b/i;

// @CLIENT tag — capture group 1 = the client code (original casing; resolved against knownClients).
const DYN_CLIENT_TAG_RE = /(?<![A-Za-z0-9])@([A-Za-z][A-Za-z0-9_-]*)/g;

// #Tag — capture group 1 = the tag name for sub-category lookup.
const DYN_CATEGORY_TAG_RE = /(?<![A-Za-z0-9])#([A-Za-z][A-Za-z0-9_/-]*)/;

/** A client + its assigned hours from the dynamic parser. */
interface DynClientHours {
  client: string;
  /** Exact decimal hours — NOT rounded. Converted to % when building ParsedTask. */
  hours: number;
}

/**
 * Replace multi-word sub-category names in a single line with their
 * hyphenated equivalents so the single-word tag regex can capture them.
 *
 * "#Quick Policy" → "#Quick-Policy"
 *
 * Why space→hyphen instead of quoting or escaping:
 *   The tag regex  /(?<![A-Za-z0-9])#([A-Za-z][A-Za-z0-9_/-]*)/  stops
 *   at the first space because spaces aren't in the character class. A
 *   simple hyphen substitution keeps the tag syntactically valid AND
 *   preserves character count so @client positions in the original line
 *   remain correct for Scenario D proximity scoring (no index shift).
 *
 * findCaseInsensitive in promptParser normalises hyphens back to spaces
 * when doing taxonomy lookups, so "#Quick-Policy" resolves correctly to
 * the "Quick Policy" sub-category entry.
 *
 * Sorted longest-first so a name like "Quick Policy Plus" is matched
 * before the shorter "Quick Policy" prefix that would otherwise eat
 * only part of the name.
 */
function preprocessMultiWordTagsForDynamic(
  line: string,
  opts: AIParseOptions,
): string {
  const multiWordNames = opts.subCategories
    .map((s) => s.name)
    .filter((n) => n.includes(" "))
    .sort((a, b) => b.length - a.length);

  let out = line;
  for (const name of multiWordNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match the tag at a word boundary — not preceded by alphanumerics.
    const re = new RegExp(`(?<![A-Za-z0-9])#${escaped}(?![A-Za-z0-9])`, "gi");
    out = out.replace(re, "#" + name.replace(/\s+/g, "-"));
  }
  return out;
}

/**
 * Look up a sub-category by tag name and return the taxonomy info
 * needed to build ParsedTask entries.
 *
 * Resolution order (most to least specific):
 *   1. Case-insensitive match in opts.subCategories, with hyphens
 *      treated as spaces — so "Quick-Policy" matches "Quick Policy".
 *   2. Legacy tag hint fallback (e.g. "bliss" → sub-category "Quick Policy")
 *      for backward-compat aliases defined in LEGACY_TAG_HINTS.
 *
 * Returns null when the tag doesn't resolve to a known sub-category OR
 * when the sub-category has no clients configured (required for Scenarios
 * A and E which must fan out across the project's client list).
 */
function lookupSubCategoryInfo(
  tagName: string,
  opts: AIParseOptions,
): {
  workCategory: string;
  subCategory: string;
  workType: string;
  clients: readonly string[];
} | null {
  // Normalize: hyphens → spaces so "#Quick-Policy" resolves "Quick Policy".
  const normalizedTag = tagName.toLowerCase().replace(/-/g, " ");

  // 1. Direct case-insensitive sub-category match.
  let sub = opts.subCategories.find(
    (s) => s.name.toLowerCase() === normalizedTag,
  );

  // 2. Legacy hint fallback — resolves aliases like "bliss" → "Quick Policy"
  //    that exist in LEGACY_TAG_HINTS but not as first-class sub-categories.
  if (!sub) {
    // Strip non-alpha chars to get the same key format as LEGACY_TAG_HINTS
    // (e.g. "Quick-Policy" → "quickpolicy" won't match "bliss", but
    //  "bliss" → "bliss" will match the "bliss" key correctly).
    const legacyKey = normalizedTag.replace(/[^a-z]/g, "");
    const legacyHint = LEGACY_TAG_HINTS[legacyKey];
    if (legacyHint?.subCategory) {
      sub = opts.subCategories.find(
        (s) => s.name.toLowerCase() === legacyHint.subCategory!.toLowerCase(),
      );
    }
  }

  if (!sub) return null;

  // Work type resolution priority:
  //   1. Taxonomy's default for this specific sub-category (e.g. "Implementation" for Geniisys)
  //   2. Taxonomy's default for the parent main category
  //   3. Hardcoded "Administrative" as last resort
  const workType =
    opts.taxonomy.defaultWorkTypeByParent[sub.name] ??
    opts.taxonomy.defaultWorkTypeByParent[sub.parentMainCategory] ??
    "Administrative";

  return {
    workCategory: sub.parentMainCategory,
    subCategory: sub.name,
    workType,
    clients: sub.clients ?? [],
  };
}

/**
 * Pair each @client with its nearest unassigned hours value.
 * Used exclusively by Scenario D (N @clients, N hour values).
 *
 * Scoring strategy to handle both "3hrs for @AUII" (hours-before-client)
 * and "@AUII 3hrs" (client-before-hours) patterns in the same line:
 *
 *   Preceding hours (hours index < client index):
 *     score = 1000 − distance   ← always positive; closer wins
 *
 *   Following hours (hours index > client index):
 *     score = −distance          ← always negative; preceding beats following
 *
 * Clients are processed left-to-right so earlier @clients claim their
 * nearest hours first.
 *
 * Returns null if any client cannot be paired (defensive; should not
 * happen when #clients === #hoursValues).
 */
function assignHoursToClients(
  clients: { name: string; index: number }[],
  hoursValues: { value: number; index: number }[],
): DynClientHours[] | null {
  // Process clients in text order so earlier ones claim their hours first.
  const sorted = [...clients].sort((a, b) => a.index - b.index);
  const usedHoursIndices = new Set<number>();
  const result: DynClientHours[] = [];

  for (const client of sorted) {
    let bestScore = -Infinity;
    let bestIdx = -1;

    for (let i = 0; i < hoursValues.length; i++) {
      if (usedHoursIndices.has(i)) continue;
      // +ve delta means hours precedes the client (preferred).
      // -ve delta means hours follows the client (fallback).
      const delta = client.index - hoursValues[i].index;
      const score = delta >= 0 ? 1000 - delta : delta;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) return null; // ran out of hours values
    usedHoursIndices.add(bestIdx);
    result.push({ client: client.name, hours: hoursValues[bestIdx].value });
  }

  return result;
}

/**
 * Inspect a single line and determine which allocation scenario (A–E) it matches.
 * Returns the per-client hours breakdown and the resolved tag name,
 * or null when the line does not match any dynamic scenario.
 *
 * All scenarios require:
 *   1. A #SubCategoryTag so we know which project to attach the work to.
 *   2. At least one hours value ("4 hours", "2.5 hrs", etc.).
 *
 * Detection order (most specific first — checked in this order to prevent
 * a more-specific pattern from being consumed by a less-specific one):
 *
 * ─── Scenario E ─────────────────────────────────────────────────────────────
 *   Trigger:  "each client" or "per client" phrase + 1 hour value
 *   Meaning:  Each project client INDIVIDUALLY gets the full hour value.
 *             The hours are NOT divided — every client gets the same amount.
 *   Example:  "Geniisys bug fix 2 hrs each client"
 *             Geniisys clients = [AFPGEN, AUII, CPAIC]
 *             → AFPGEN 2 hrs, AUII 2 hrs, CPAIC 2 hrs  (6 hrs total)
 *
 * ─── Scenario D ─────────────────────────────────────────────────────────────
 *   Trigger:  N @clients + N hour values (N ≥ 2, counts match)
 *   Meaning:  Each @client is paired with its nearest hours value by
 *             character-position proximity scoring (see assignHoursToClients).
 *   Example:  "Provided 3hrs @AUII and 4hrs @AFPGEN on #Geniisys"
 *             → AUII 3 hrs, AFPGEN 4 hrs
 *
 * ─── Scenario B ─────────────────────────────────────────────────────────────
 *   Trigger:  1 @client + 1 hour value
 *   Meaning:  Direct one-to-one assignment.  The @client gets all the hours.
 *   Example:  "Provided support for @AUII on #Geniisys for 2 hours"
 *             → AUII 2 hrs
 *
 * ─── Scenario C ─────────────────────────────────────────────────────────────
 *   Trigger:  N @clients (N ≥ 2) + 1 hour value
 *   Meaning:  Total hours divided equally among the explicitly listed clients.
 *             Exact decimal division — no rounding at this stage.
 *   Example:  "@AUII and @AFPGEN on #Geniisys for 4 hours"
 *             → AUII 2 hrs, AFPGEN 2 hrs
 *
 * ─── Scenario A ─────────────────────────────────────────────────────────────
 *   Trigger:  0 @clients + 1 hour value + known #SubCategory with clients
 *   Meaning:  "Relationship bridge" — no clients were mentioned, so look up
 *             ALL clients assigned to the sub-category in Admin Settings and
 *             divide the total hours equally among them.
 *             Exact decimal division — no rounding at this stage.
 *   Example:  "Worked on #Geniisys for 4 hours"
 *             Geniisys clients = [AFPGEN, AUII, CPAIC]
 *             → AFPGEN 1.333h, AUII 1.333h, CPAIC 1.333h  (4h total)
 *
 * Returns null for lines that don't match any scenario (e.g. ambiguous
 * patterns like 1 client + 2 separate hour values, or no #tag found).
 * Those lines are forwarded to the AI / rule parser.
 */
function detectDynamicScenario(
  line: string,
  opts: AIParseOptions,
): { clientHours: DynClientHours[]; tagName: string } | null {
  // ── Preprocess multi-word sub-category tags ──────────────────────────
  // "#Quick Policy" → "#Quick-Policy" so the single-word tag regex can
  // capture the full name. Space→hyphen keeps character counts identical,
  // so @client positions extracted from the original line below are still
  // valid for Scenario D proximity scoring.
  const processedLine = preprocessMultiWordTagsForDynamic(line, opts);

  // ── Require a #tag — without one we cannot resolve the category ──────
  const tagMatch = processedLine.match(DYN_CATEGORY_TAG_RE);
  if (!tagMatch) return null;
  const tagName = tagMatch[1]; // may be "Quick-Policy"; lookupSubCategoryInfo normalises hyphens

  // ── Extract @clients with character positions from the ORIGINAL line ──
  // Positions are used in Scenario D to pair each client with its hours.
  const clientMatches = [...line.matchAll(new RegExp(DYN_CLIENT_TAG_RE.source, "g"))];
  const clients = clientMatches.map((m) => ({
    name: opts.knownClients.find(c => c.toLowerCase() === m[1].toLowerCase()) ?? m[1],
    index: m.index ?? 0,
  }));

  // ── Extract hours values with character positions ────────────────────
  // New RegExp instance each time to avoid stale lastIndex on the module-level regex.
  const hoursMatches = [...line.matchAll(new RegExp(HOURS_VALUE_RE.source, "gi"))];
  const hoursValues = hoursMatches.map((m) => ({
    value: parseFloat(m[1]),
    index: m.index ?? 0,
  }));

  // Lines with no hour references are left to the AI/rule parser.
  if (hoursValues.length === 0) return null;

  // ── Scenario E ───────────────────────────────────────────────────────
  // Trigger: "each client" / "per client" phrase + exactly 1 hour value.
  // The hours value applies INDIVIDUALLY to EVERY configured project client
  // (not divided). Total hours = hoursValue × numberOfClients.
  if (EACH_CLIENT_RE.test(line) && hoursValues.length === 1) {
    const subInfo = lookupSubCategoryInfo(tagName, opts);
    if (!subInfo) return null;
    // Fan out across OFFICIAL clients only — exclude "(custom)" artifacts and
    // any unregistered ad-hoc name from the sub-category assignment list.
    const officialClients = filterOfficialClients(subInfo.clients, opts.knownClients);
    if (officialClients.length === 0) return null;
    const hoursEach = hoursValues[0].value;
    return {
      tagName,
      clientHours: officialClients.map((c) => ({ client: c, hours: hoursEach })),
    };
  }

  // ── Scenario D ───────────────────────────────────────────────────────
  // Trigger: exactly N @clients + exactly N hour values (N ≥ 2).
  // Each @client is paired with its positionally nearest hours value.
  // See assignHoursToClients for the proximity-scoring algorithm.
  if (clients.length >= 2 && hoursValues.length === clients.length) {
    const assigned = assignHoursToClients(clients, hoursValues);
    if (assigned) return { tagName, clientHours: assigned };
  }

  // ── Scenarios B and C ────────────────────────────────────────────────
  // Trigger: 1+ @clients + exactly 1 hour value.
  //   B (1 client): direct assignment — that client gets all the hours.
  //   C (N clients): total hours divided equally; exact decimal, no rounding.
  // Both collapse into the same arithmetic: hoursEach = total / clients.length.
  if (clients.length >= 1 && hoursValues.length === 1) {
    const totalHours = hoursValues[0].value;
    const hoursEach = totalHours / clients.length; // exact decimal, no Math.round
    return {
      tagName,
      clientHours: clients.map((c) => ({ client: c.name, hours: hoursEach })),
    };
  }

  // ── Scenario A ───────────────────────────────────────────────────────
  // Trigger: 0 @clients + exactly 1 hour value + #SubCat with configured clients.
  // "Relationship bridge": no explicit client mentioned, so look up ALL
  // clients assigned to this sub-category in Admin Settings and divide
  // total hours equally. Exact decimal — no rounding at this stage.
  if (clients.length === 0 && hoursValues.length === 1) {
    const subInfo = lookupSubCategoryInfo(tagName, opts);
    if (!subInfo) return null;
    // Fan out across OFFICIAL clients only — exclude "(custom)" artifacts and
    // any unregistered ad-hoc name so the equal division uses a clean divisor.
    const officialClients = filterOfficialClients(subInfo.clients, opts.knownClients);
    if (officialClients.length === 0) return null;
    const totalHours = hoursValues[0].value;
    const hoursEach = totalHours / officialClients.length; // exact decimal, filtered divisor
    return {
      tagName,
      clientHours: officialClients.map((c) => ({ client: c, hours: hoursEach })),
    };
  }

  // No scenario matched (e.g. 1 client with 2 separate hour mentions — ambiguous).
  return null;
}

/**
 * Pre-process `text` for hour-based dynamic allocation patterns (Scenarios A–E).
 *
 * Each non-empty line is inspected independently:
 *   - Lines matching a scenario → produce one ParsedTask per resolved client.
 *   - Lines not matching any scenario → collected in `unmatchedLines` for the
 *     caller to forward to the AI/rule parser.
 *
 * Percentage math:
 *   percentage = (hours / WORKDAY_HOURS) × 100   (no intermediate rounding)
 *
 * Example: 4 hours / 3 Geniisys clients
 *   hoursEach  = 4 / 3  = 1.3333333333333333
 *   percentage = 1.3333333333333333 / 8 × 100  = 16.666666666666668%
 *   Stored as a raw float — the UI formats it for display.
 */
function parseDynamicAllocations(
  text: string,
  opts: AIParseOptions,
): { tasks: ParsedTask[]; unmatchedLines: string[] } {
  const tasks: ParsedTask[] = [];
  const unmatchedLines: string[] = [];

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const match = detectDynamicScenario(line, opts);
    if (!match) {
      unmatchedLines.push(line);
      continue;
    }

    // Resolve taxonomy a second time here to get workCategory/workType.
    // (detectDynamicScenario already called it internally for Scenarios A and E,
    // but we need the result here too for building ParsedTask entries.)
    const subInfo = lookupSubCategoryInfo(match.tagName, opts);
    if (!subInfo || match.clientHours.length === 0) {
      // Tag didn't resolve or produced no clients — fall through.
      unmatchedLines.push(line);
      continue;
    }

    for (const ch of match.clientHours) {
      // Convert hours → percentage. MUST preserve exact float — no rounding.
      const percentage = (ch.hours / WORKDAY_HOURS) * 100;
      tasks.push({
        id: crypto.randomUUID(),
        team: opts.defaultTeam,
        workCategory: subInfo.workCategory,
        subCategory: subInfo.subCategory,
        workType: subInfo.workType,
        client: ch.client,
        // Keep the full original line as description for traceability.
        description: line,
        percentage,
      });
    }
  }

  return { tasks, unmatchedLines };
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------

/**
 * Parse work allocation text using Claude, with rule-parser fallback.
 *
 * Flow:
 *   1. If no API key configured OR forceRuleFallback → rule parser.
 *   2. Extract bullet text + percentage deterministically.
 *   3. Send bullets to Claude as a batch classification request.
 *   4. On success: merge Claude's classifications with the extracted
 *      percentages to build ParsedTask[].
 *   5. On failure: log, toast (caller), fall back to rule parser.
 *
 * Returns `{tasks, source}` — callers use `source` to display an AI
 * badge on generated cards when source === 'ai'.
 */
/**
 * Public entry point. Wraps the parsing pipeline so `$Name` enhancement
 * tokens are lifted onto `enhancementTag` on EVERY return path — dynamic
 * pre-pass, AI path, and rule fallback alike — rather than at each of the
 * six `return` statements inside. `applyEnhancementTags` is idempotent, so
 * the rule path running it internally too is harmless.
 */
export async function parseWithAI(
  text: string,
  opts: AIParseOptions,
): Promise<AIParseResult> {
  const result = await parseWithAIInner(text, opts);
  return {
    ...result,
    tasks: applyEnhancementTags(result.tasks, opts.enhancementTags ?? []),
  };
}

async function parseWithAIInner(
  text: string,
  opts: AIParseOptions,
): Promise<AIParseResult> {
  const notify = opts.onPathSelected ?? (() => {});

  // ── Pre-pass: dynamic allocation (Scenarios A–E) ──────────────────
  // Runs deterministically before the AI/rule path. Lines matching an
  // hour-based pattern produce ParsedTask entries directly; the remaining
  // lines (percentage bullets, plain text) are forwarded below.
  const { tasks: dynamicTasks, unmatchedLines } =
    parseDynamicAllocations(text, opts);
  const unmatchedText = unmatchedLines.join("\n");

  // If every line was handled by the dynamic pre-pass, return immediately.
  if (!unmatchedText.trim()) {
    const source: "ai" | "rules" = dynamicTasks.length > 0 ? "ai" : "rules";
    notify(source);
    return { tasks: dynamicTasks, source };
  }

  // Short-circuit to rules when: no key, forced fallback, or empty text.
  const hasKey = !!opts.apiKey && opts.apiKey.trim().length > 0;
  if (!hasKey || opts.forceRuleFallback) {
    notify("rules");
    return {
      tasks: [...dynamicTasks, ...runRuleParser(unmatchedText, opts)],
      source: "rules",
    };
  }

  try {
    const bullets = extractBullets(unmatchedText);
    if (bullets.length === 0) {
      // No percentage-bearing lines in the unmatched remainder.
      // Rule parser handles this the same way; defer to it.
      notify("rules");
      return {
        tasks: [...dynamicTasks, ...runRuleParser(unmatchedText, opts)],
        source: "rules",
      };
    }

    const classifications = await callClaude(bullets, opts);
    const aiTasks = mergeClassifications(bullets, classifications, opts);
    notify("ai");
    return { tasks: [...dynamicTasks, ...aiTasks], source: "ai" };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown AI parse error";
    // Dev-only warning; caller toasts to the user.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[aiParser] falling back to rule parser:", message);
    }
    notify("rules");
    return {
      tasks: [...dynamicTasks, ...runRuleParser(unmatchedText, opts)],
      source: "rules",
      aiErrorMessage: message,
    };
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

interface ExtractedBullet {
  id: string;
  /** Original bullet line with leading dash/bullet stripped. */
  description: string;
  /** Percentage extracted from trailing `- 40%` style. Null if missing. */
  percentage: number | null;
  /** All @CLIENT tags found in the description, uppercased. Empty if none. */
  clients: string[];
}

/**
 * Pull bullet-shaped lines out of the input text. Mirrors the rule
 * parser's line-matching regexes (NATURAL_RE + hierarchical bullets)
 * but only to the degree needed to identify separate activities and
 * their percentages. The classification is outsourced to Claude.
 *
 * Each bullet gets a stable ID used to correlate the model's
 * response with the original text. Model is told to echo the ID
 * back in its JSON so we're not relying on array-position alignment.
 */
function extractBullets(text: string): ExtractedBullet[] {
  const out: ExtractedBullet[] = [];
  const lines = text.split("\n");
  let id = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Match both simple "- Text - 40%" and hierarchical "-- Text - 40%".
    // We don't distinguish them for AI parsing — each line is one
    // activity if it has a percentage. The `%` is REQUIRED so a bullet whose
    // text ends in a bare number (e.g. an SR ticket) is never misread as a
    // percentage — the same defect that let `-- 41631` become 41631%.
    const m = line.match(
      /^(?:[-–]{1,}|[•*])\s*(.+?)\s*[-–—:]\s*(\d+(?:\.\d+)?)\s*%\s*$/,
    );
    if (!m) continue;

    const description = m[1].trim();
    const percentage = parseFloat(m[2]);
    if (isNaN(percentage)) continue;

    // Extract every @CLIENT tag so mergeClassifications can fan out to
    // multiple tasks when more than one client appears in the same bullet.
    const clients = [...description.matchAll(/@([A-Za-z][A-Za-z0-9_-]*)/g)]
      .map((cm) => cm[1]);

    out.push({
      id: `b${id++}`,
      description,
      percentage,
      clients,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------

interface ClaudeClassification {
  id: string;
  category: string;
  subCategory: string | null;
  workType: string;
  client: string;
}

/**
 * Build the classification prompt and call the Claude Messages API
 * directly from the browser.
 *
 * Returns one classification per input bullet, keyed by id.
 *
 * Security note: using browser-direct access means the API key is
 * exposed to the user's browser. Fine for a demo / single-tenant
 * install where the user provides their own key. For multi-tenant
 * production, replace with a backend proxy.
 */
async function callClaude(
  bullets: readonly ExtractedBullet[],
  opts: AIParseOptions,
): Promise<ClaudeClassification[]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const prompt = buildPrompt(bullets, opts);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey as string,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Anthropic API ${response.status}: ${body.slice(0, 200) || response.statusText}`,
    );
  }

  const data = await response.json();
  const textBlock = Array.isArray(data.content)
    ? data.content.find((b: { type: string }) => b.type === "text")
    : null;
  if (!textBlock || typeof textBlock.text !== "string") {
    throw new Error("Anthropic response missing text content");
  }

  // Models sometimes wrap JSON in ```json fences despite the prompt.
  // Strip those defensively.
  const raw = textBlock.text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Anthropic returned invalid JSON: ${raw.slice(0, 100)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Anthropic response was not a JSON array");
  }

  // Validate each item before trusting it. Defensive — if the model
  // hallucinated a category/workType not in the taxonomy, we want to
  // know in the caller rather than silently pushing garbage through.
  const validated: ClaudeClassification[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" && item !== null &&
      typeof (item as Record<string, unknown>).id === "string" &&
      typeof (item as Record<string, unknown>).category === "string" &&
      typeof (item as Record<string, unknown>).workType === "string" &&
      typeof (item as Record<string, unknown>).client === "string"
    ) {
      const rec = item as Record<string, unknown>;
      validated.push({
        id: rec.id as string,
        category: rec.category as string,
        subCategory:
          typeof rec.subCategory === "string" && rec.subCategory.length > 0
            ? (rec.subCategory as string)
            : null,
        workType: rec.workType as string,
        client: rec.client as string,
      });
    }
  }
  return validated;
}

/**
 * Construct the classification prompt. Lays out the taxonomy so the
 * model understands valid choices, then lists the bullets and asks
 * for a JSON array keyed by ID.
 *
 * Kept in a single template so prompt tuning stays in one place.
 */
function buildPrompt(
  bullets: readonly ExtractedBullet[],
  opts: AIParseOptions,
): string {
  // Build taxonomy summary.
  const subsByMain: Record<string, string[]> = {};
  for (const sub of opts.subCategories) {
    if (!subsByMain[sub.parentMainCategory]) {
      subsByMain[sub.parentMainCategory] = [];
    }
    subsByMain[sub.parentMainCategory].push(sub.name);
  }

  const workTypesByParent: Record<string, string[]> = {};
  for (const main of opts.mainCategories) {
    const subs = subsByMain[main] ?? [];
    const parents = subs.length === 0 ? [main] : subs;
    for (const p of parents) {
      workTypesByParent[p] = opts.workTypes
        .filter((w) => w.parents.includes(p))
        .map((w) => w.name);
    }
  }

  const mainCategoryList = opts.mainCategories.join(" | ");
  const subCategoryLines = Object.entries(subsByMain)
    .map(([main, subs]) => `  - ${main} → ${subs.join(", ")}`)
    .join("\n");

  const workTypeLines = Object.entries(workTypesByParent)
    .map(([parent, wts]) => `  - ${parent}: ${wts.join(", ")}`)
    .join("\n");

  const clientList = opts.knownClients.join(", ");
  const fallbackClient = opts.fallbackClient ?? "Internal";

  const bulletLines = bullets
    .map((b) => `  ${b.id}: "${b.description.replace(/"/g, '\\"')}"`)
    .join("\n");

  return `You are a work allocation classifier for an internal time-tracking app. Given a user's description of work, classify it into a structured allocation entry.

TAXONOMY (valid choices only):

Main categories: ${mainCategoryList}

Sub categories (each belongs to exactly one main):
${subCategoryLines || "  (none)"}

Work types by parent (main categories with sub categories do NOT attach work types directly — use the sub categories):
${workTypeLines}

Known clients: ${clientList || "(none)"}
Fallback client when none detected: "${fallbackClient}"

CLASSIFICATION RULES:
1. If the description contains #SubCategoryName (e.g. #Geniisys), the sub category is authoritative. Main category follows (e.g. Projects for #Geniisys).
2. If #Main/Sub form is used (e.g. #Projects/Geniisys), follow it exactly.
3. @ClientCode tokens (e.g. @AUII) indicate the client. Treat them as authoritative.
4. When neither tag is present, infer category and work type from description content.
5. Pick the single most specific work type valid under the resolved parent. E.g. "development" under #Geniisys should map to "Product Development" (the Geniisys-specific work type), not a generic "Development" from the main category.
6. Sub category is null when the main category has no sub categories defined (e.g. HR, IT).
7. For cross-cutting keywords like "meeting" under a specific sub category: prefer the sub-specific work type if one exists, otherwise use the generic one from the sub's list.

DESCRIPTIONS TO CLASSIFY:
${bulletLines}

Respond with ONLY a JSON array, one object per input ID, no prose, no markdown fences:
[
  {"id":"b0","category":"...","subCategory":"..."|null,"workType":"...","client":"..."},
  ...
]

Every "category" MUST be from the Main categories list. Every "subCategory" MUST either be null or appear in the Sub categories list under its main. Every "workType" MUST appear in the Work types list under its resolved parent. Every "client" MUST be from the Known clients list OR "${fallbackClient}".`;
}

// ---------------------------------------------------------------------
// Merging: combine Claude's classifications with extracted metadata
// ---------------------------------------------------------------------

function mergeClassifications(
  bullets: readonly ExtractedBullet[],
  classifications: readonly ClaudeClassification[],
  opts: AIParseOptions,
): ParsedTask[] {
  const byId = new Map(classifications.map((c) => [c.id, c]));
  const fallbackClient = opts.fallbackClient ?? "Internal";

  return bullets.flatMap((b) => {
    const c = byId.get(b.id);
    if (!c || b.percentage === null) return [];

    // When the original description contained multiple @CLIENT tags, fan out
    // into one task per client and divide the percentage equally.
    // A single client (or none) falls through to the AI-classified client.
    // Resolve each raw tag against knownClients (case-insensitive) so the
    // canonical casing from Admin Settings is preserved on the card.
    const resolvedBulletClients = b.clients.map(
      raw => opts.knownClients.find(c => c.toLowerCase() === raw.toLowerCase()) ?? raw,
    );

    // Project-client fan-out (Epic 1): when the bullet has NO explicit
    // @client but the classified sub-category has assigned project clients,
    // split the percentage equally across them — e.g. "#Project1 support -
    // 100%" with Project1 = [C1, C2] → two cards at 50% each. Mirrors the
    // rule parser's Scenario A so both parse paths behave identically.
    // Fan out ONLY across official, registered clients — strip any
    // "(custom)" frontend artifact or unregistered ad-hoc name that leaked
    // into the sub-category's assignment list. `percentageEach` below divides
    // by this filtered length, so the split still sums correctly (Epic 1 + 2).
    // Parent falls back to the main category: post-flatten a project is a
    // MAIN category with no sub tier, so `c.subCategory` is null and a
    // sub-only gate would silently drop the fan-out.
    const fanOutParent = c.subCategory ?? c.category;
    const projectClients =
      resolvedBulletClients.length === 0 && fanOutParent
        ? filterOfficialClients(
            opts.taxonomy.clientsBySubCategory?.[fanOutParent] ?? [],
            opts.knownClients,
          )
        : [];

    const clients =
      resolvedBulletClients.length > 1
        ? resolvedBulletClients
        : projectClients.length > 0
          ? [...projectClients]
          : [c.client || fallbackClient];

    const percentageEach = b.percentage / clients.length;

    // Each fan-out task gets a distinct UUID so React keys never collide
    // and UI state doesn't silently overwrite sibling cards.
    return clients.map((client) => ({
      id: crypto.randomUUID(),
      team: opts.defaultTeam,
      workCategory: c.category,
      subCategory: c.subCategory,
      workType: c.workType,
      client,
      description: b.description,
      percentage: percentageEach,
    }));
  });
}

// ---------------------------------------------------------------------
// Rule-parser fallback delegation
// ---------------------------------------------------------------------

function runRuleParser(text: string, opts: AIParseOptions): ParsedTask[] {
  return parseWorkAllocation(text, {
    defaultTeam: opts.defaultTeam,
    knownClients: opts.knownClients,
    fallbackClient: opts.fallbackClient,
    taxonomy: opts.taxonomy,
    enhancementTags: opts.enhancementTags,
    // Pass the live DB rules so the fallback can detect custom work types.
    // Omit (→ DEFAULT_INFERENCE_RULES) only when none are configured.
    ...(opts.inferenceRules && opts.inferenceRules.length > 0
      ? { inferenceRules: opts.inferenceRules }
      : {}),
  });
}

// ---------------------------------------------------------------------
// Connection test — used by Settings "Test Key" button
// ---------------------------------------------------------------------

/**
 * Send a minimal request to validate an API key. Returns an object
 * describing success/failure so the Settings UI can surface the
 * specific reason (wrong key vs network error vs rate limit).
 */
export async function testApiKey(
  apiKey: string,
  model: string = DEFAULT_MODEL,
): Promise<{ ok: true } | { ok: false; status: number | null; message: string }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: 'Reply with just "ok".' }],
      }),
    });

    if (response.ok) return { ok: true };

    const body = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      message: body.slice(0, 200) || response.statusText,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}
