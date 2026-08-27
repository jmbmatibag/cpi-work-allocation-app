/**
 * Prompt parser — converts free-text work summaries into structured
 * ParsedTask entries.
 *
 * Pure module: no React, no imports from @/data or @/components.
 * Inference rules and the known-clients list are passed in as options
 * so callers (Workspace, tests, future config-context) can supply
 * their own. A DEFAULT_INFERENCE_RULES export is provided for the
 * current Workspace call site and tests that want the out-of-the-box
 * behavior.
 *
 * Three input formats supported:
 *   1. Structured: `... (team), ... (work category), ... (work type), ... (client), ... - XX%`
 *   2. Hierarchical: `ClientName:\n-- task1\n-- task2 - XX%`
 *   3. Simple: `- description - XX%`
 *
 * Phase P: tag recognition upgraded to support the three-level
 * taxonomy. Recognized tag forms:
 *
 *   #General      — main category only (subCategory = null)
 *   #Geniisys     — sub category, main category inferred from taxonomy
 *   #Projects/Geniisys — explicit main/sub path
 *
 *   Plus legacy short-codes: #bdmktg #hr #general etc. — kept for
 *   backward compatibility with ~160 seeded journal entries that
 *   use them.
 */

import {
  extractLinePercent,
  clampBlockPercentage,
} from "./blockPercentage";

// =====================================================================
// Types
// =====================================================================

import {
  ENHANCEMENT_SIGIL,
  ENHANCEMENT_SIGIL_RE,
  enhancementTagBody,
} from "./tagHighlight";

export interface ParsedTask {
  /** Unique ID for React keying. Set by the parser on fan-out; generated at render time otherwise. */
  id?: string;
  team: string;
  workCategory: string;
  /**
   * Phase P addition. Null when the main category has no sub
   * categories (HR, IT, etc. in the default taxonomy) or when the
   * user didn't specify one. Consumers must handle the null case.
   */
  subCategory: string | null;
  workType: string;
  client: string;
  /**
   * Structured enhancement tag lifted from a `$Name` token in the text.
   * Only ever a canonical roster name — see applyEnhancementTags.
   *
   * Optional so the parser's nine task-emission branches don't each have to
   * set it; the single post-pass fills it in and consumers read `?? null`.
   */
  enhancementTag?: string | null;
  description: string;
  percentage: number;
}

export interface InferenceRule {
  /** Case-insensitive substrings. Score = number of keywords present in the text. */
  keywords: readonly string[];
  category: string;
  /**
   * Phase P: inference rules may optionally target a sub category.
   * When set and the rule wins, the ParsedTask's subCategory is
   * populated. When absent (most existing rules), subCategory stays
   * null and the caller decides whether to fill it in from context.
   */
  subCategory?: string | null;
  workType: string;
}

/**
 * Describes the live taxonomy — passed in from the caller (typically
 * derived from ClientsConfigContext) so the parser can resolve
 * sub-category tags without importing the context directly.
 *
 * Keeping the parser pure pays off here: tests can pass a minimal
 * taxonomy, the Workspace call site passes the live one, and the
 * parser doesn't need to know where the data comes from.
 */
export interface TaxonomySnapshot {
  /**
   * Map from sub category name → parent main category name. Used to
   * resolve a `#Geniisys` tag to `(Projects, Geniisys)`.
   */
  subCategoryToMain: Readonly<Record<string, string>>;
  /**
   * Map from parent name (either main or sub category) → a sensible
   * default work type for that parent. Used when a tag specifies a
   * category/sub but keyword inference finds no valid work type
   * under that parent.
   *
   * Example: `{"Geniisys": "Implementation", "HR": "Recruitment"}`.
   *
   * Missing keys fall through to a global default ("Administrative").
   */
  defaultWorkTypeByParent: Readonly<Record<string, string>>;
  /**
   * Map from parent name → list of work types valid under that
   * parent. Used for hybrid resolution: when a tag sets category +
   * sub category, we still run keyword inference on the description
   * and accept the inferred work type ONLY if it's valid under the
   * resolved parent. Otherwise fall back to the parent's default.
   *
   * Example: `{"Geniisys": ["Implementation", "Enhancement", "Testing"],
   *            "HR": ["Recruitment", "Onboarding", ...]}`
   *
   * Missing keys → parser falls back to the default work type.
   */
  workTypesByParent: Readonly<Record<string, readonly string[]>>;
  /**
   * Scenario A — Project-Client relationship map.
   *
   * Maps each sub-category name → the list of client codes configured
   * for that project in Admin Settings (SubCategory.clients[]).
   *
   * Used exclusively by Scenario A fan-out: when the parser detects a
   * #SubCat tag but finds NO explicit @client tag in the same line, it
   * creates one ParsedTask card per project client, splitting the line's
   * percentage equally among them.
   *
   * Example with "#Geniisys sprint - 30%", Geniisys clients = [AFPGEN, AUII, CPAIC]:
   *   → 3 cards: AFPGEN 10%, AUII 10%, CPAIC 10%
   *
   * Scenario B override: if any @CLIENT tag appears in the line, fan-out
   * is skipped and only the explicitly tagged client(s) receive a card.
   * This field is optional — when absent no fan-out occurs (backward compat
   * with call sites that don't provide it, e.g. tests).
   *
   * Keyed by TAXONOMY PARENT, not strictly by sub-category: a flattened
   * project (e.g. "Geniisys" promoted out of "Projects") is a MAIN category
   * with no sub tier, so its roster is keyed on the main name. The field
   * keeps its original name to avoid churning every call site; the domain
   * is simply wider than it was.
   */
  clientsBySubCategory?: Readonly<Record<string, readonly string[]>>;
}

export interface ParseOptions {
  /** Fallback team name when the text doesn't specify one. Required — callers decide their own fallback. */
  defaultTeam: string;
  /** Ordered list of inference rules. First rule with the highest keyword-count score wins. */
  inferenceRules?: readonly InferenceRule[];
  /** Known client codes/names. Matched case-insensitively against the task text when no @tag is provided. */
  knownClients?: readonly string[];
  /** Label used when no client can be inferred. Default: "N/A". */
  fallbackClient?: string;
  /**
   * Live taxonomy snapshot. When provided, `#SubCat` and
   * `#Main/Sub` tags resolve via this. When absent, only the legacy
   * hardcoded tag hints + main category tags work.
   */
  taxonomy?: TaxonomySnapshot;
  /**
   * Live Enhancement roster. When supplied, a `$Name` token in the text is
   * lifted onto ParsedTask.enhancementTag and removed from the description.
   * Omitted (or empty) means `$` is treated as ordinary punctuation.
   */
  enhancementTags?: readonly string[];
}

// =====================================================================
// Inference rules (unchanged from pre-Phase-P)
// =====================================================================

/**
 * Default inference rules. Lead by keyword; first highest-scoring rule
 * wins. Order matters only for ties — more specific rules earlier is a
 * reasonable policy but not enforced.
 *
 * Keyword matching: each keyword with *no* spaces is matched with word
 * boundaries (so "lead" won't fire inside "tech lead") — see
 * matchesKeyword below. Multi-word phrases like "lead generation" or
 * "microsoft 365" are matched as substrings since phrase boundaries
 * already scope them naturally.
 *
 * NOTE: `m365` / `microsoft 365` / `o365` live in IT/Infrastructure —
 * in the pre-Phase-F rules they were in HR/Recruitment.
 *
 * The BD/Mktg/Sales "Lead Generation" rule dropped the bare token
 * "lead" — it fired on "tech lead", "team lead", "project lead" and
 * misclassified management activities as sales work. Use
 * "lead generation" / "sales lead" / "prospect" for explicit signal.
 *
 * Phase P: subCategory is optional. Default seeded rules leave it
 * null (main-category-only). An admin can add sub-category-targeting
 * rules via the Inference Rules editor.
 */
export const DEFAULT_INFERENCE_RULES: readonly InferenceRule[] = [
  { keywords: ["server", "infrastructure", "aws", "cloud", "migration", "vm", "hosting", "m365", "microsoft 365", "o365"], category: "IT", workType: "Infrastructure" },
  { keywords: ["security", "audit", "firewall", "vulnerability", "pentest", "penetration test"], category: "IT", workType: "Security" },
  { keywords: ["devops", "ci/cd", "pipeline", "docker", "kubernetes"], category: "IT", workType: "DevOps" },
  { keywords: ["helpdesk", "ticket", "support request"], category: "IT", workType: "Helpdesk" },
  { keywords: ["network", "connectivity", "dns", "vpn"], category: "IT", workType: "Networking" },
  { keywords: ["monitoring", "downtime", "uptime", "alerting"], category: "IT", workType: "Monitoring" },
  { keywords: ["marketing", "campaign", "content", "branding", "advertising"], category: "Sales, Marketing & BD", workType: "Marketing Campaign" },
  { keywords: ["lead generation", "sales lead", "prospect"], category: "Sales, Marketing & BD", workType: "Lead Generation" },
  { keywords: ["proposal", "rfp", "bid"], category: "Sales, Marketing & BD", workType: "Proposals" },
  { keywords: ["sales", "revenue", "deal", "closing"], category: "Sales, Marketing & BD", workType: "Sales" },
  { keywords: ["interview", "recruitment", "hiring", "candidate", "technical interview"], category: "HR", workType: "Recruitment" },
  { keywords: ["onboarding", "orientation", "new hire"], category: "HR", workType: "Onboarding" },
  { keywords: ["policy", "handbook", "compliance"], category: "HR", workType: "Policy" },
  { keywords: ["training", "workshop", "upskilling"], category: "HR", workType: "Training" },
  { keywords: ["meeting", "standup", "sync", "1:1", "catchup", "tech lead", "team lead"], category: "General Work", workType: "Meetings" },
  { keywords: ["documentation", "wiki", "readme", "doc"], category: "General Work", workType: "Documentation" },
  { keywords: ["research", "spike", "investigation"], category: "General Work", workType: "Research" },
  { keywords: ["admin", "administrative"], category: "General Work", workType: "Administrative" },
  { keywords: ["email", "communication", "update"], category: "General Work", workType: "Communication" },
  { keywords: ["budget", "forecast", "variance"], category: "Finance", workType: "Budgeting" },
  { keywords: ["reporting", "report"], category: "Finance", workType: "Reporting" },
  { keywords: ["development", "coding", "feature", "feature work"], category: "Projects", workType: "Development" },
  { keywords: ["implementation", "implement", "rollout implementation", "integration"], category: "Projects", workType: "Implementation" },
  { keywords: ["enhancement", "enhance", "improvement"], category: "Projects", workType: "Enhancement" },
  { keywords: ["maintenance", "maintain", "patch", "hotfix", "bugfix", "bug fix"], category: "Projects", workType: "Maintenance" },
  { keywords: ["testing", "qa", "uat"], category: "Projects", workType: "Testing" },
  { keywords: ["deployment", "release", "rollout"], category: "Projects", workType: "Deployment" },
  { keywords: ["planning", "sprint", "kickoff"], category: "Projects", workType: "Planning" },
  { keywords: ["review", "feedback", "retrospective"], category: "Projects", workType: "Review" },
  { keywords: ["claims", "renewal", "underwriting", "policy processing", "endorsement"], category: "Projects", workType: "Support" },
  { keywords: ["product development", "product dev"], category: "Projects", workType: "Product Development" },
  { keywords: ["support", "assisting", "assist"], category: "Projects", workType: "Support" },
];

// =====================================================================
// Tag hints
// =====================================================================

/**
 * Legacy short-code tags. When the prompt text contains e.g.
 * `#bdmktg`, map it to a canonical (main, sub, workType) triple.
 *
 * Kept from pre-Phase-P because the 160 seeded journal entries use
 * these short codes heavily. Removing them would break every round-
 * trip through the aggregator. A future cleanup could standardize
 * on full names, but that's not this phase.
 *
 * Pre-Phase-P these mapped to standalone categories (Geniisys,
 * Quick Policy, BODYSHOP). Phase-P made them sub categories under
 * `Projects`; the Projects flatten then promoted every project back to a
 * top-level main category. So:
 *   - `#geniisys` and `#bliss` resolve to (Geniisys / Quick Policy, null,
 *     Implementation) — main categories with no sub category tier.
 *   - `#projects` is gone. `Projects` was retired and its children became
 *     separate mains, so there is no single successor to map it to.
 *     Dropping the entry sends `#projects` through the normal
 *     `inferCategory` keyword path instead, which classifies from the
 *     bullet's own text. That is still a guess, but one derived from what
 *     the user actually wrote — strictly better than a hardcoded mapping
 *     to a category that no longer exists.
 *   - `#bodyshop` no longer exists as a category. Kept here as a
 *     no-op fallback that maps to (General Work, Administrative) so
 *     legacy entries don't crash — admins can recategorize manually.
 *
 * NOTE these are FALLBACKS only — resolveTag consults the live taxonomy
 * first and reaches this table only when a tag matches no category, sub
 * category, or work type. `#geniisys` therefore resolves via the taxonomy
 * in normal operation; the hint matters when the settings snapshot is
 * unavailable. `#bliss` has no taxonomy entry at all, so it ALWAYS lands
 * here — which is why it pointed at a dead category until now.
 */
export const LEGACY_TAG_HINTS: Record<
  string,
  { category: string; subCategory: string | null; workType: string }
> = {
  it:        { category: "IT",             subCategory: null,       workType: "Infrastructure" },
  general:   { category: "General Work",   subCategory: null,       workType: "Meetings" },
  hr:        { category: "HR",             subCategory: null,       workType: "Recruitment" },
  finance:   { category: "Finance",        subCategory: null,       workType: "Reporting" },
  bdmktg:    { category: "Sales, Marketing & BD",  subCategory: null,       workType: "Marketing Campaign" },
  sales:     { category: "Sales, Marketing & BD",  subCategory: null,       workType: "Sales" },
  // Post-flatten these are MAIN categories, not sub categories — `Projects`
  // was retired and every project promoted a level up.
  geniisys:  { category: "Geniisys",       subCategory: null,       workType: "Implementation" },
  bliss:     { category: "Quick Policy",   subCategory: null,       workType: "Implementation" },
  // Retired category — kept so legacy #bodyshop tags don't crash.
  bodyshop:  { category: "General Work",   subCategory: null,       workType: "Administrative" },
};

/**
 * Normalize a raw tag token to a lookup key.
 *
 * "BD/Mktg" -> "bdmktg"
 * "#Geniisys" -> "geniisys"
 * "Projects/Geniisys" -> "projects/geniisys"  (preserve the slash for path handling)
 */
function normalizeTagKey(tag: string): string {
  return tag.toLowerCase().trim();
}

/**
 * Resolve a raw `#Tag` to a (category, subCategory, workType) triple.
 *
 * Resolution order:
 *   1. Explicit path `Main/Sub` — always wins, most specific.
 *   2. Dynamic sub-category lookup against the taxonomy snapshot.
 *   3. Dynamic main-category lookup against the taxonomy snapshot.
 *   4. Legacy short-code hints (bdmktg, hr, geniisys, ...).
 *
 * Returns undefined if nothing matches — the caller falls back to
 * keyword inference.
 */
function resolveTag(
  rawTag: string,
  taxonomy: TaxonomySnapshot | undefined,
): { category: string; subCategory: string | null; workType: string } | undefined {
  const normalized = normalizeTagKey(rawTag);

  // Path form: "main/sub"
  if (normalized.includes("/")) {
    const [mainPart, subPart] = normalized.split("/");
    // Look up the main by case-insensitive match against taxonomy
    // subCategoryToMain values, or against the legacy hints.
    const resolvedMain = taxonomy
      ? findCaseInsensitive(Object.values(taxonomy.subCategoryToMain), mainPart) ??
        findCaseInsensitive(Object.keys(defaultParentsFromTaxonomy(taxonomy)), mainPart)
      : undefined;
    const resolvedSub = taxonomy
      ? findCaseInsensitive(Object.keys(taxonomy.subCategoryToMain), subPart)
      : undefined;
    if (resolvedMain && resolvedSub) {
      const workType =
        taxonomy?.defaultWorkTypeByParent[resolvedSub] ??
        taxonomy?.defaultWorkTypeByParent[resolvedMain] ??
        "Administrative";
      return { category: resolvedMain, subCategory: resolvedSub, workType };
    }
    // Fall through to single-part resolution if the path doesn't
    // resolve — e.g. "#bodyshop/whatever" with no taxonomy match.
  }

  // Sub category match (taxonomy-driven) — more specific than main.
  if (taxonomy) {
    const subName = findCaseInsensitive(
      Object.keys(taxonomy.subCategoryToMain),
      normalized,
    );
    if (subName) {
      const main = taxonomy.subCategoryToMain[subName];
      const workType =
        taxonomy.defaultWorkTypeByParent[subName] ??
        taxonomy.defaultWorkTypeByParent[main] ??
        "Administrative";
      return { category: main, subCategory: subName, workType };
    }

    // Main category match (taxonomy-driven).
    const mainName = findCaseInsensitive(
      Object.keys(defaultParentsFromTaxonomy(taxonomy)),
      normalized,
    );
    if (mainName) {
      // Only return a main-cat hit if the key actually corresponds to
      // a main (not a sub). The Object.keys() above includes both
      // mains and subs via defaultWorkTypeByParent; filter to mains.
      const isActuallyMain =
        !Object.keys(taxonomy.subCategoryToMain).some(
          (s) => s.toLowerCase() === mainName.toLowerCase(),
        );
      if (isActuallyMain) {
        const workType =
          taxonomy.defaultWorkTypeByParent[mainName] ?? "Administrative";
        return { category: mainName, subCategory: null, workType };
      }
    }
  }

  // Legacy short-code hints — strip non-alpha chars for matching
  // (#bd-mktg, #BD/Mktg, #bdmktg all collapse to "bdmktg").
  const legacyKey = normalized.replace(/[^a-z]/g, "");
  const legacyHint = LEGACY_TAG_HINTS[legacyKey];
  if (legacyHint) {
    return legacyHint;
  }

  return undefined;
}

function findCaseInsensitive(
  pool: readonly string[],
  needle: string,
): string | undefined {
  // Normalize both sides: lowercase + collapse any run of non-alphanumeric
  // characters (hyphens, commas, slashes, ampersands, spaces) to a single
  // space. This lets the hyphenated form emitted by preprocessMultiWordTags
  // ("Sales-Marketing-BD") match the stored taxonomy name
  // ("Sales, Marketing & BD") even when special characters differ.
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nNorm = normalize(needle);
  return pool.find((p) => normalize(p) === nNorm);
}

/**
 * Return a { main: workType } map derived from defaultWorkTypeByParent.
 * Used internally when we need the list of known parent names.
 *
 * Just an alias for `taxonomy.defaultWorkTypeByParent` right now;
 * pulled out so future caching / filtering can hook in here.
 */
function defaultParentsFromTaxonomy(
  taxonomy: TaxonomySnapshot,
): Readonly<Record<string, string>> {
  return taxonomy.defaultWorkTypeByParent;
}

// =====================================================================
// Keyword matching + inference
// =====================================================================

/**
 * True if `keyword` appears in `text`. Single-word keywords match with
 * word boundaries so "lead" doesn't fire inside "tech lead" or
 * "team lead". Multi-word phrases ("lead generation", "microsoft 365")
 * are matched as substrings — the phrase boundaries already scope
 * them correctly.
 *
/**
 * Reduce a single word to a rough base form by stripping common
 * inflectional / derivational suffixes. Deliberately lightweight (not a
 * real Porter stemmer) — just enough that "testing", "tests", "tested"
 * and "test" all collapse toward the same "test" stem.
 *
 * Suffixes are ordered longest-first so "development" → "develop" strips
 * "ment" before the shorter "s"/"ed" rules can nibble the wrong ending.
 * A minimum remaining length guards against over-stemming short words
 * ("les" should not become "l").
 */
function stemWord(word: string): string {
  const w = word.toLowerCase();
  const suffixes = ["ment", "ing", "ers", "er", "ed", "es", "s"];
  for (const suf of suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      return w.slice(0, -suf.length);
    }
  }
  return w;
}

/**
 * Epic 2 — stemming-based, boundary-aware keyword matching.
 *
 * Previously this required an exact keyword at a left word boundary, so a
 * rule keyword "Testing" failed to catch "test" or "tests". An interim fix
 * used a raw `text.includes(stem)` substring test, which over-matched:
 * keyword "planning" (stem "plann") fired inside "aeroplanning".
 *
 * This version reduces the keyword to its stem and matches it with a
 * **left word boundary** so it can't fire mid-word, while leaving the right
 * side open so any inflection (plural / gerund / past / nominalization)
 * still matches. "test" / "testing" both stem to "test" and catch "test",
 * "tests", "tested", "testing" — but "contest" and "aeroplanning" no longer
 * produce false positives.
 *
 * - Multi-word phrases ("lead generation", "microsoft 365") → plain
 *   case-insensitive substring; the phrase boundaries already scope them.
 * - Very short keywords (stem < 3 chars, e.g. "qa", "vm") get BOTH a left
 *   and right boundary so they only match as standalone tokens — short
 *   fragments are the most prone to false positives.
 * - Everything else → left-bounded stem, `\b(stem)…`, right side open for
 *   suffixes.
 *
 * All matching is case-insensitive.
 */
function matchesKeyword(text: string, keyword: string): boolean {
  const lowerText = text.toLowerCase();
  // Lowercase + strip trailing punctuation so "test," or "testing." stem cleanly.
  const lowerKw = keyword.toLowerCase().trim().replace(/[^a-z0-9]+$/, "");
  if (!lowerKw) return false;

  if (lowerKw.includes(" ")) return lowerText.includes(lowerKw);

  const stem = stemWord(lowerKw);
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Short stems (qa, vm, ci): require both boundaries — they're too small to
  // trust an open right side (would match "qa" inside "qat", "quays", etc.).
  if (stem.length < 3) {
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").test(lowerText);
  }

  // Left boundary + stem, right side open for inflectional suffixes
  // (…s, …es, …ing, …ed, …ment, …er, …). Boundary-aware per Epic 2:
  // catches variations without matching inside a larger unrelated word.
  return new RegExp(`(?:^|[^a-z0-9])${escaped}[a-z0-9]*`, "i").test(lowerText);
}

/**
 * Score-and-pick the best-matching inference rule for a piece of text.
 * Ties go to the earliest rule. Falls back to General Work/Administrative
 * when no rule matches.
 *
 * Phase P: returns subCategory too (null when the winning rule didn't
 * target one).
 */
export function inferCategory(
  text: string,
  rules: readonly InferenceRule[] = DEFAULT_INFERENCE_RULES,
): { category: string; subCategory: string | null; workType: string } {
  const lower = text.toLowerCase();
  let bestCategory = "General Work";
  let bestSubCategory: string | null = null;
  let bestWorkType = "Administrative";
  let bestScore = 0;
  for (const rule of rules) {
    const score = rule.keywords.filter((kw) => matchesKeyword(lower, kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
      bestSubCategory = rule.subCategory ?? null;
      bestWorkType = rule.workType;
    }
  }
  return { category: bestCategory, subCategory: bestSubCategory, workType: bestWorkType };
}

/**
 * Find the first known-client code embedded in `text`. Case-insensitive.
 * Returns the configured fallback label when nothing matches.
 */
export function matchClient(
  text: string,
  knownClients: readonly string[] = [],
  fallback = "N/A",
): string {
  const lower = text.toLowerCase();
  for (const client of knownClients) {
    if (lower.includes(client.toLowerCase())) return client;
  }
  return fallback;
}

/**
 * Pick the work type for a tag-resolved activity purely from keyword evidence
 * in the description. The contract (per product decision):
 *
 *   read description → match keywords against the scoped inference rules →
 *   a rule matches → use its work type
 *   nothing matches → return "" (BLANK)
 *
 * We NEVER fall back to a parent default. A guessed default silently passes a
 * card through manager review looking "detected" when it wasn't; a blank Work
 * Type makes the gap visible so the user fixes it before submitting.
 *
 * Two things make this correct where the naive version failed:
 *
 *  1. Ignore the structural names when scoring — the tag-resolved category and
 *     sub category, plus known client codes. Auto-generated rules embed the
 *     parent name (e.g. "geniisys") as a keyword, and Scenario-A client rules
 *     embed the client code (e.g. "afpgen"); both match EVERY scoped rule
 *     equally, so counting them just produces ties that get won by declaration
 *     order. That is exactly why "#Geniisys devops management" could land on
 *     "Debugging": only the shared "geniisys" keyword scored, so the first
 *     Geniisys rule won instead of the one whose keywords ("devops",
 *     "management") actually appear. Excluding them lets the real work-type
 *     keywords decide (`ignoreNames`).
 *
 *  2. Only consider rules whose work type is selectable under this parent
 *     (present in `workTypesByParent[parent]`), so a matching-but-unselectable
 *     work type can't beat a matching-and-valid one, and the result is always
 *     something the dropdown can actually show.
 *
 * Case-insensitive throughout.
 */
function refineWorkTypeForParent(
  text: string,
  parent: string,
  category: string,
  ignoreNames: readonly (string | null)[],
  inferenceRules: readonly InferenceRule[],
  taxonomy: TaxonomySnapshot | undefined,
): string {
  // Parent/category/sub names carry no work-type signal — drop them from scoring.
  const ignore = new Set(
    ignoreNames
      .filter((n): n is string => !!n)
      .map((n) => n.toLowerCase().trim()),
  );

  // The set of work types selectable under this parent (lowercased), or null
  // when the taxonomy doesn't scope this parent.
  const validList = taxonomy
    ? taxonomy.workTypesByParent[parent] ??
      taxonomy.workTypesByParent[
        Object.keys(taxonomy.workTypesByParent).find(
          (k) => k.toLowerCase() === parent.toLowerCase(),
        ) ?? ""
      ]
    : undefined;
  const validSet =
    validList && validList.length > 0
      ? new Set(validList.map((w) => w.toLowerCase()))
      : null;

  // Candidate rules are scoped by WORK-TYPE VALIDITY under the parent, NOT by
  // the rule's stored category. This is the key fix: a work type like
  // "Meetings" is valid under "Geniisys" but its keyword rule is stored under
  // category "General Work"; scoping by category dropped it, so "#Geniisys
  // meetings" always came back blank. Scoping by validSet keeps any rule whose
  // work type the dropdown can actually show, regardless of where the rule
  // lives. When the taxonomy can't scope this parent (validSet null), fall
  // back to same-category rules to avoid cross-category keyword pollution.
  const candidates = inferenceRules.filter((r) =>
    validSet
      ? validSet.has(r.workType.toLowerCase())
      : r.category.toLowerCase() === category.toLowerCase(),
  );

  // Highest-scoring candidate wins; ties break to the earliest rule (stable).
  let best: InferenceRule | null = null;
  let bestScore = 0;
  for (const rule of candidates) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (ignore.has(kw.toLowerCase().trim())) continue;
      if (matchesKeyword(text, kw)) score++;
    }
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  // Nothing matched (or nothing matched that's selectable here) → BLANK.
  if (!best || bestScore === 0) return "";
  return best.workType;
}

// =====================================================================
// Epic 2 — "Specific Enhancement" work type forcing
// =====================================================================

/**
 * Case-insensitive, whitespace-resistant matcher for "Specific Enhancement".
 * `\s*` between the words tolerates the glued form "SpecificEnhancement",
 * the canonical "Specific Enhancement" and any extra-spaced variant alike.
 */
const SPECIFIC_ENHANCEMENT_RE = /specific\s*enhancement/i;
const SPECIFIC_ENHANCEMENT_WORK_TYPE = "Specific Enhancement";

/**
 * Epic 2 — when a description explicitly names "Specific Enhancement", that
 * phrase is authoritative: the work type is forced to "Specific Enhancement"
 * PROVIDED it is selectable under the resolved parent (so the UI dropdown can
 * actually render it). Consolidation (journalAggregation) already routes these
 * logs to Projects → Geniisys and keeps each one on its own card; this closes
 * the loop by pinning the work type deterministically instead of leaving it to
 * generic keyword scoring.
 *
 * Returns null when the phrase is absent, or present but not a valid work type
 * under this parent — in which case the caller falls back to Epic 4's scoped
 * inference (and, failing that, a BLANK work type). We never invent an
 * unselectable value.
 */
function forceSpecificEnhancementWorkType(
  text: string,
  parent: string,
  taxonomy: TaxonomySnapshot | undefined,
): string | null {
  if (!SPECIFIC_ENHANCEMENT_RE.test(text)) return null;

  // No taxonomy to validate against (e.g. minimal test callers) → trust the
  // explicit phrase.
  if (!taxonomy) return SPECIFIC_ENHANCEMENT_WORK_TYPE;

  const validList =
    taxonomy.workTypesByParent[parent] ??
    taxonomy.workTypesByParent[
      Object.keys(taxonomy.workTypesByParent).find(
        (k) => k.toLowerCase() === parent.toLowerCase(),
      ) ?? ""
    ];
  const isSelectable =
    !!validList &&
    validList.some(
      (w) => w.toLowerCase() === SPECIFIC_ENHANCEMENT_WORK_TYPE.toLowerCase(),
    );

  return isSelectable ? SPECIFIC_ENHANCEMENT_WORK_TYPE : null;
}

// =====================================================================
// Parser
// =====================================================================

// =====================================================================
// Runtime regexes (below the types block)
// =====================================================================

/**
 * Detects an @CLIENT tag anywhere in a line.
 *
 * Used by Scenario A to distinguish "no explicit client" (fan-out
 * across all project clients) from "client explicitly named" (Scenario B
 * — only that client gets a card).
 *
 * Pattern breakdown:
 *   (?<![A-Za-z0-9])  — negative lookbehind so we don't match mid-word
 *   @                  — literal tag prefix
 *   [A-Za-z]           — tag must start with a letter (not a number)
 *   [A-Za-z0-9_-]*     — followed by alphanumerics, underscores, or hyphens
 */
const CLIENT_TAG_RE_INLINE = /(?<![A-Za-z0-9])@[A-Za-z][A-Za-z0-9_-]*/;

// Hierarchical continuations require a 2+ dash marker (or •/*).
// A single dash is reserved for simple-format entries, so a line like
// `- Sprint planning - 20%` following a hierarchical header is *not*
// absorbed into that block — it's parsed as its own simple entry.
const HIERARCHICAL_BULLET = /^(?:[-–]{2,}|[•*])\s/;
const STRIP_LEADING_BULLET = /^(?:[-–]{1,}|[•*])\s*/;
// Percentage extraction lives in ./blockPercentage (extractLinePercent). The
// `%` sign is REQUIRED there so a bare number like `-- 41631` (a Service-
// Request ticket missing its "SR " prefix) can never be read as 41631%.
// STRIP_TRAILING_PCT mirrors that contract — it only strips a trailing token
// that carries a literal `%`, so bare numbers survive as description text.
const STRIP_TRAILING_PCT = /\s*[-–—:]\s*(?:\d+(?:\.\d+)?|\.\d+)\s*%\s*$/;

const STRUCTURED_RE =
  /^[-•*]?\s*(.+?)\s*\(team\)\s*,\s*(.+?)\s*\(work\s*category\)\s*,\s*(.+?)\s*\(work\s*type\)\s*,\s*(.+?)\s*\(client\)\s*,\s*(.+?)\s*[-–—:]\s*(\d+(?:\.\d+)?)\s*%?\s*$/i;

const NATURAL_RE = /^[-•*]?\s*(.+?)\s*[-–—:]\s*(\d+(?:\.\d+)?)\s*%?\s*$/;

/**
 * Regex for finding a `#Category` tag anywhere in a string. Supports:
 *   #Hr          (simple)
 *   #BD/Mktg     (slash in name — the BD/Mktg/Sales short form)
 *   #Projects/Geniisys (full path)
 *
 * Captures the tag body (without the leading #). The negative lookbehind
 * ensures the # is not preceded by word chars (so it's a real tag, not
 * part of a URL fragment or comment).
 */
const TAG_RE = /(?<![A-Za-z0-9])#([A-Za-z][A-Za-z0-9_/-]*)/;

/**
 * Preprocess input to handle multi-word tag names (e.g. "#Quick Policy").
 * The TAG_RE regex is single-word by design, so we collapse known
 * multi-word taxonomy names to hyphenated form (`#Quick-Policy`)
 * BEFORE regex extraction. resolveTag and findCaseInsensitive treat
 * hyphens as spaces during lookup so the hyphenated form resolves.
 *
 * Sorted by length desc so longer names match before shorter prefixes:
 * "Quick Policy Plus" wins over "Quick Policy" wins over "Quick".
 */
function preprocessMultiWordTags(
  text: string,
  taxonomy: TaxonomySnapshot | undefined,
): string {
  if (!taxonomy) return text;
  // Any taxonomy name carrying a separator — space, comma, ampersand,
  // slash, hyphen — can't be captured by the single-token TAG_RE and must
  // be collapsed to a hyphenated slug first. Widened from "contains a
  // space" to "contains any non-alphanumeric char" so punctuated names
  // like "Sales, Marketing & BD" are handled, not just "Quick Policy".
  const names: string[] = [
    ...Object.keys(taxonomy.subCategoryToMain),
    ...Object.keys(defaultParentsFromTaxonomy(taxonomy)),
  ].filter((n) => /[^A-Za-z0-9]/.test(n));
  if (names.length === 0) return text;

  // Longest first to avoid partial matches eating shorter ones.
  names.sort((a, b) => b.length - a.length);

  let out = text;
  for (const name of names) {
    // Build a whitespace-/punctuation-tolerant matcher. Split the name into
    // its alphanumeric word runs, then rejoin them with a separator class
    // that accepts the taxonomy's own punctuation (comma, ampersand, slash,
    // hyphen, en/em dash) plus arbitrary surrounding whitespace. This lets a
    // user type any of:
    //   #Sales, Marketing & BD      (canonical)
    //   #Sales,Marketing & BD       (missing space)
    //   #Sales ,  Marketing  &  BD  (extra padding)
    // and all collapse to the same "#Sales-Marketing-BD" slug. If the text
    // after the # matches no known multi-word name, nothing is rewritten and
    // TAG_RE falls back to plain single-word extraction (graceful degrade).
    const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (words.length === 0) continue;
    const pattern = words
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s,&/–—-]+");
    const re = new RegExp(`(?<![A-Za-z0-9])#${pattern}(?![A-Za-z0-9])`, "gi");
    // Strip any character that TAG_RE can't capture (commas, ampersands,
    // spaces, etc.) so the resulting slug is safe for the regex to extract.
    // findCaseInsensitive normalises both sides back to plain words for
    // comparison, so "Sales-Marketing-BD" round-trips to "Sales, Marketing & BD".
    const hyphenated =
      "#" +
      name.replace(/[^A-Za-z0-9/]+/g, "-").replace(/^-|-$/g, "");
    out = out.replace(re, hyphenated);
  }
  return out;
}

/**
 * Restrict a project's fan-out client list to OFFICIAL clients only.
 *
 * Scenario A/E fan-out spreads one #SubCategory entry across "all clients"
 * assigned to that project. The candidate list comes from the sub-category's
 * saved assignments (`clientsBySubCategory`), which can be polluted by two
 * kinds of non-official, frontend-only artifacts:
 *
 *   1. A value literally carrying the "(custom)" suffix — the label the
 *      Workspace / Team Hub client dropdown renders for any card client that
 *      isn't in the master roster (see Workspace.tsx). This is a pure UI
 *      artifact and must never spawn its own auto-generated card.
 *   2. An ad-hoc client name that was typed on a card but never registered
 *      in Admin Settings — i.e. it is absent from the master `knownClients`
 *      roster (the authoritative "is this an official, DB-registered
 *      client?" test).
 *
 * A candidate survives only if it clears BOTH guards. Excluding these here
 * also keeps the percentage math correct: callers divide the block % by the
 * length of the RETURNED array, so removing a bogus client no longer steals a
 * slice of the allocation (Epic 2).
 */
export function filterOfficialClients(
  candidates: readonly string[],
  knownClients: readonly string[],
): string[] {
  // Case-insensitive membership set of the master (official) client roster.
  const officialRoster = new Set(knownClients.map((c) => c.toLowerCase()));
  return candidates.filter((name) => {
    // Guard 1: drop any residual "(custom)" UI artifact defensively.
    if (name.toLowerCase().includes("(custom)")) return false;
    // Guard 2: keep only clients that are officially registered.
    return officialRoster.has(name.toLowerCase());
  });
}

/**
 * Parse a work-summary text into structured ParsedTask entries.
 *
 * Returns [] if no lines parse. Preserves the order tasks appear in
 * the source text (within a format; hierarchical headers consume all
 * their following bullets before the loop advances).
 */
// =====================================================================
// Enhancement tokens (`$AXA-MTC`)
// =====================================================================

/**
 * Lift `$Name` tokens off each task's description onto `enhancementTag`.
 *
 * Runs as ONE pass over the finished results rather than being threaded
 * through the parser's nine task-emission points. That is deliberate: none of
 * those branches strip unrecognised tokens, so the sigil survives every path
 * (structured, hierarchical, natural, fan-out) and arrives here intact. One
 * insertion point is also one place to get the stripping right.
 *
 * Only roster names match — `enhancementTagBody` builds no single-word
 * fallback — so "$whatever" stays in the description as literal text instead
 * of becoming an unvalidated value in Finance's column. The stored tag is the
 * CANONICAL roster spelling, not what the user typed.
 */
export function applyEnhancementTags(
  tasks: readonly ParsedTask[],
  roster: readonly string[],
): ParsedTask[] {
  const body = enhancementTagBody(roster);
  if (!body) return tasks.map((t) => ({ ...t }));

  const find = new RegExp(`(?<![A-Za-z0-9])${ENHANCEMENT_SIGIL_RE}${body}`, "i");
  // Also eat one trailing space so removing a token doesn't leave a double gap.
  const strip = new RegExp(`(?<![A-Za-z0-9])${ENHANCEMENT_SIGIL_RE}${body}\\s?`, "gi");

  return tasks.map((task) => {
    const hit = task.description.match(find);
    if (!hit) return { ...task };

    // Map the typed text back to its canonical roster spelling: the user may
    // have typed "!axa smart claims" for "AXA-SMART CLAIMS".
    const typed = hit[0].slice(ENHANCEMENT_SIGIL.length);
    const canonical =
      roster.find((name) => new RegExp(`^${enhancementTagBody([name])}$`, "i").test(typed)) ??
      null;

    return {
      ...task,
      enhancementTag: canonical,
      description: task.description.replace(strip, "").replace(/\s{2,}/g, " ").trim(),
    };
  });
}

export function parseWorkAllocation(
  text: string,
  options: ParseOptions,
): ParsedTask[] {
  const {
    defaultTeam,
    inferenceRules = DEFAULT_INFERENCE_RULES,
    knownClients = [],
    fallbackClient = "N/A",
    taxonomy,
    enhancementTags = [],
  } = options;

  const lines = preprocessMultiWordTags(text, taxonomy)
    .split("\n")
    .map((l) => l.trimEnd());
  const results: ParsedTask[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // Hierarchical: `Header:` followed by `-- bullet` lines.
    const headerMatch = line.match(/^([^-•*].+?):\s*$/);
    if (headerMatch && i + 1 < lines.length) {
      const headerText = headerMatch[1].trim();
      const bulletLines: string[] = [];
      let blockPercentage = 0;
      let j = i + 1;

      while (j < lines.length) {
        const bLine = lines[j].trim();
        if (!bLine) {
          j++;
          continue;
        }
        if (!HIERARCHICAL_BULLET.test(bLine)) break;

        // Only a token with a literal `%` counts as a percentage. Bare
        // numbers / SR IDs (e.g. `-- 41631`) return null and are preserved as
        // description text — never summed into the allocation.
        const linePct = extractLinePercent(bLine);
        if (linePct !== null) {
          blockPercentage += linePct;
          bulletLines.push(
            bLine
              .replace(STRIP_TRAILING_PCT, "")
              .replace(STRIP_LEADING_BULLET, "")
              .trim(),
          );
        } else {
          bulletLines.push(bLine.replace(STRIP_LEADING_BULLET, "").trim());
        }
        j++;
      }

      // Defence in depth: bound the summed block percentage so that even if a
      // future parsing hole reappears, an anomaly like 41637 can never reach
      // the Allocation Progress ring. Valid blocks (all well under 100) are
      // unaffected.
      blockPercentage = clampBlockPercentage(blockPercentage);

      if (bulletLines.length > 0) {
        // Client resolution priority, matching the simple-format branch:
        //   1. Explicit @tag in header
        //   2. Known client name mentioned anywhere in header
        //   3. Whole header text as a custom client label
        //   4. Configured fallback ("Internal" / "N/A")
        const clientTagMatch = headerText.match(/(?<![A-Za-z0-9])@([A-Za-z][A-Za-z0-9_-]*)/);
        let client: string;
        if (clientTagMatch) {
          const rawTag = clientTagMatch[1];
          client = knownClients.find(c => c.toLowerCase() === rawTag.toLowerCase()) ?? rawTag;
        } else {
          const matched = matchClient(headerText, knownClients, fallbackClient);
          if (matched !== fallbackClient) {
            client = matched;
          } else {
            // Strip any #Category tag from the headerText so it
            // doesn't leak into the client name. Also strip a trailing
            // "Work" label (the aggregator emits headers like
            // "#Projects Work:" where "Work" is a placeholder).
            const cleaned = headerText
              .replace(/(?<![A-Za-z0-9])#[A-Za-z][A-Za-z0-9_/-]*\s*/g, "")
              .replace(/\s*work\s*$/i, "")
              .trim();
            client = cleaned || fallbackClient;
          }
        }

        // Epic 3: the parent header line is NEVER discarded. It leads the
        // description as the card's base context (and drives the card title in
        // the UI); the child sub-tasks follow as bullets. Previously the header
        // was consumed only for tag/client resolution and dropped, which made
        // the first bullet masquerade as the card title.
        const description = [
          headerText,
          ...bulletLines.map((b) => `• ${b}`),
        ].join("\n");

        // Phase P: hybrid tag + keyword resolution.
        //
        // When a tag matches, the tag authoritatively sets the
        // category and sub category, but the work type is picked
        // by running keyword inference over the description. This
        // handles cases like:
        //
        //   "#Geniisys Work:
        //    -- Implementation for AUII - 40%"
        //
        // where the tag correctly routes to Projects/Geniisys, and
        // the keyword "implementation" identifies the work type.
        // The parent's default work type is the fallback only when
        // inference finds nothing valid under that parent.
        let workCategory: string;
        let subCategory: string | null;
        let workType: string;
        const categoryTagMatch = headerText.match(TAG_RE);
        const resolved = categoryTagMatch
          ? resolveTag(categoryTagMatch[1], taxonomy)
          : undefined;
        if (resolved) {
          workCategory = resolved.category;
          subCategory = resolved.subCategory;
          const combinedText = `${headerText} ${bulletLines.join(" ")}`;
          // Epic 2: an explicit "Specific Enhancement" phrase pins the work
          // type (when selectable here); otherwise Epic 4 scoped inference runs.
          workType =
            forceSpecificEnhancementWorkType(
              combinedText,
              subCategory ?? workCategory,
              taxonomy,
            ) ??
            refineWorkTypeForParent(
              combinedText,
              subCategory ?? workCategory,
              resolved.category,
              [resolved.category, resolved.subCategory, ...knownClients],
              inferenceRules,
              taxonomy,
            );
        } else {
          const inferred = inferCategory(
            `${headerText} ${bulletLines.join(" ")}`,
            inferenceRules,
          );
          workCategory = inferred.category;
          subCategory = inferred.subCategory;
          workType = inferred.workType;
        }

        // ── Multiple explicit @client tags in the header → fan out ────────
        // e.g. "@CIC @Concise #Geniisys:" splits blockPercentage across both.
        const headerClientTags = [
          ...headerText.matchAll(/(?<![A-Za-z0-9])@([A-Za-z][A-Za-z0-9_-]*)/g),
        ].map(
          (m) =>
            knownClients.find((c) => c.toLowerCase() === m[1].toLowerCase()) ??
            m[1],
        );
        if (headerClientTags.length > 1) {
          const splitPct = blockPercentage / headerClientTags.length;
          for (const pc of headerClientTags) {
            results.push({
              team: defaultTeam,
              workCategory,
              subCategory,
              workType,
              client: pc,
              description,
              percentage: splitPct,
            });
          }
          i = j;
          continue;
        }

        // ── Scenario A: Project-Client fan-out (hierarchical) ─────────────
        // When a #SubCat tag resolved to a sub-category that has project-
        // client assignments AND no @client appears in the header, create
        // one card per project client and split blockPercentage equally.
        //
        // Example: "#Geniisys Work:\n-- Sprint - 30%"
        //   Geniisys clients = [AFPGEN, AUII, CPAIC]
        //   → 3 cards at 10% each (30 / 3)
        //
        // Scenario B override: @client tag in header → single card only.
        const headerHasClientTag = CLIENT_TAG_RE_INLINE.test(headerText);
        // Fall back to the main category: post-flatten a project IS the
        // category, so `resolved.subCategory` is null for "#Geniisys" and a
        // sub-only gate would silently skip the fan-out — one card instead
        // of three, with no error to notice.
        const fanOutParent = resolved?.subCategory ?? resolved?.category;
        if (
          !headerHasClientTag &&
          fanOutParent &&
          taxonomy?.clientsBySubCategory
        ) {
          // Fan out ONLY across official, registered clients — never the
          // "(custom)" frontend artifacts that can leak into the assignment
          // list. The divisor below is the filtered length so the split still
          // sums to blockPercentage (Epic 1 + Epic 2).
          const projectClients = filterOfficialClients(
            taxonomy.clientsBySubCategory[fanOutParent] ?? [],
            knownClients,
          );
          if (projectClients.length > 0) {
            const splitPct = blockPercentage / projectClients.length;
            for (const pc of projectClients) {
              results.push({
                team: defaultTeam,
                workCategory,
                subCategory,
                workType,
                client: pc,
                description,
                percentage: splitPct,
              });
            }
            i = j;
            continue;
          }
        }
        // ─────────────────────────────────────────────────────────────────

        results.push({
          team: defaultTeam,
          workCategory,
          subCategory,
          workType,
          client,
          description,
          percentage: blockPercentage,
        });
        i = j;
        continue;
      }
    }

    // Structured: `A (team), B (work category), C (work type), D (client), E - XX%`
    // Note: structured format doesn't include sub category in the
    // positional schema — keeping the existing six-slot layout. Sub
    // category is null for structured entries. If richer structured
    // forms are needed later, extend the regex.
    const structuredMatch = line.match(STRUCTURED_RE);
    if (structuredMatch) {
      results.push({
        team: structuredMatch[1].trim(),
        workCategory: structuredMatch[2].trim(),
        subCategory: null,
        workType: structuredMatch[3].trim(),
        client: structuredMatch[4].trim(),
        description: structuredMatch[5].trim(),
        percentage: parseFloat(structuredMatch[6]),
      });
      i++;
      continue;
    }

    // Simple: `- description - XX%`
    const naturalMatch = line.match(NATURAL_RE);
    if (naturalMatch) {
      const description = naturalMatch[1].trim();
      const percentage = parseFloat(naturalMatch[2]);

      // Phase P: hybrid tag + keyword resolution. Same rule as the
      // hierarchical branch — tag fixes main/sub; keyword inference
      // on the description refines the work type (constrained to
      // valid work types under the resolved parent).
      let workCategory: string;
      let subCategory: string | null;
      let workType: string;
      const categoryTagMatch = description.match(TAG_RE);
      const resolved = categoryTagMatch
        ? resolveTag(categoryTagMatch[1], taxonomy)
        : undefined;
      if (resolved) {
        workCategory = resolved.category;
        subCategory = resolved.subCategory;
        // Epic 2: an explicit "Specific Enhancement" phrase pins the work type
        // (when selectable here); otherwise Epic 4 scoped inference runs.
        workType =
          forceSpecificEnhancementWorkType(
            description,
            subCategory ?? workCategory,
            taxonomy,
          ) ??
          refineWorkTypeForParent(
            description,
            subCategory ?? workCategory,
            resolved.category,
            [resolved.category, resolved.subCategory, ...knownClients],
            inferenceRules,
            taxonomy,
          );
      } else {
        const inferred = inferCategory(description, inferenceRules);
        workCategory = inferred.category;
        subCategory = inferred.subCategory;
        workType = inferred.workType;
      }

      // Client resolution priority (mirrors hierarchical branch):
      //   1. Explicit @tag — accepted verbatim even when not in
      //      knownClients, so an unmapped `@AAA` flows through to
      //      the allocation card as "AAA" instead of collapsing to
      //      the Internal fallback. The Workspace dropdown renders
      //      any non-listed value as "<name> (custom)" so the user
      //      can see and either keep or remap it.
      //   2. Known-client substring match.
      //   3. Configured fallback.
      //   0. Multiple explicit @client tags → one card per client, % split
      //      equally (e.g. "#Geniisys Meetings @CIC @Concise - 47%" →
      //      CIC 23.5% + Concise 23.5%).
      const explicitClientTags = [
        ...description.matchAll(/(?<![A-Za-z0-9])@([A-Za-z][A-Za-z0-9_-]*)/g),
      ].map(
        (m) =>
          knownClients.find((c) => c.toLowerCase() === m[1].toLowerCase()) ??
          m[1],
      );

      if (explicitClientTags.length > 1) {
        const splitPct = percentage / explicitClientTags.length;
        for (const pc of explicitClientTags) {
          results.push({
            team: defaultTeam,
            workCategory,
            subCategory,
            workType,
            client: pc,
            description,
            percentage: splitPct,
          });
        }
        i++;
        continue;
      }

      const client =
        explicitClientTags.length === 1
          ? explicitClientTags[0]
          : matchClient(description, knownClients, fallbackClient);

      // ── Scenario A: Project-Client fan-out (simple line) ───────────────
      // When #SubCat is detected, the sub-category has client assignments,
      // and no @client appears in the line → one card per project client,
      // percentage split equally.
      //
      // Example: "- #Geniisys sprint review - 30%"
      //   Geniisys clients = [AFPGEN, AUII, CPAIC]
      //   → 3 cards at 10% each
      //
      // Scenario B override: @client present in description → single card.
      const lineHasClientTag = CLIENT_TAG_RE_INLINE.test(description);
      // Same main-category fallback as the header path above.
      const lineFanOutParent = resolved?.subCategory ?? resolved?.category;
      if (
        !lineHasClientTag &&
        lineFanOutParent &&
        taxonomy?.clientsBySubCategory
      ) {
        // Fan out ONLY across official, registered clients — never the
        // "(custom)" frontend artifacts that can leak into the assignment
        // list. The divisor below is the filtered length so the split still
        // sums to the line percentage (Epic 1 + Epic 2).
        const projectClients = filterOfficialClients(
          taxonomy.clientsBySubCategory[lineFanOutParent] ?? [],
          knownClients,
        );
        if (projectClients.length > 0) {
          const splitPct = percentage / projectClients.length;
          for (const pc of projectClients) {
            results.push({
              team: defaultTeam,
              workCategory,
              subCategory,
              workType,
              client: pc,
              description,
              percentage: splitPct,
            });
          }
          i++;
          continue;
        }
      }
      // ─────────────────────────────────────────────────────────────────

      results.push({
        team: defaultTeam,
        workCategory,
        subCategory,
        workType,
        client,
        description,
        percentage,
      });
    }
    i++;
  }

  // Single post-pass: lift `$Name` tokens onto enhancementTag. Every emission
  // branch above leaves the token in the description, so this catches them all.
  return applyEnhancementTags(results, enhancementTags);
}
