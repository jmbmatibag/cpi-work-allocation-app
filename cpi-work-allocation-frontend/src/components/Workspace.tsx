import { useState, useMemo, useRef, useCallback } from "react";
import { Trash2, ChevronDown, ChevronRight, X, Flag, Plus, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import AIPromptBox from "@/components/AIPromptBox";
import {
  parseWorkAllocation,
  type ParsedTask,
  type TaxonomySnapshot,
} from "@/lib/promptParser";
import { parseWithAI } from "@/lib/aiParser";
import {
  useClientsConfig,
  FALLBACK_CLIENT,
} from "@/contexts/ClientsConfigContext";
import { useAIConfig } from "@/contexts/AIConfigContext";
import type { ActivityFlag } from "@/contexts/AllocationsContext";
import { buildHighlightRegex, renderTagged } from "@/lib/tagHighlight";

// Normalize a stored description for display or storage.
//
// Pass 1 — de-hyphenate category tags: #Quick-Policy → #Quick Policy
// Pass 2 — expand inline "--" bullet lists to multi-line format:
//           "@AAA : -- IP Whitelisting -- Resolving …"
//           → "@AAA :\n• IP Whitelisting\n• Resolving …"
// Pass 3 — fan-out @tag cleanup: when multiple @CLIENT tags exist,
//           remove sibling tags (keep only this card's client).
// Pass 4 — reorder: move a leading @client tag to end-of-line when
//           it precedes a #category tag (natural sentence order).
//           Annotation pattern "@AAA : …" (colon follows) is left alone.
// Pass 5 — collapse extra whitespace per line; preserve newlines.
//
// Idempotent — safe to call on already-normalized text.
function normalizeDescription(desc: string, client: string): string {
  // Pass 1
  let result = desc.replace(
    /#([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)/g,
    (_, tag) => "#" + tag.replace(/-/g, " "),
  );

  // Pass 2 — "@TAG : -- item1 -- item2" to "@TAG :\n• item1\n• item2"
  result = result.replace(
    /^(@[A-Za-z][A-Za-z0-9_-]*\s*:\s*)(?:--\s*)(.+)$/m,
    (_, header, rest) => {
      const bullets = rest.split(/\s*--\s*/).filter(Boolean);
      return (
        header.trimEnd() +
        "\n" +
        bullets.map((b: string) => `• ${b.trim()}`).join("\n")
      );
    },
  );

  // Pass 3 — fan-out sibling removal
  const clientTagCount = (result.match(/@[A-Za-z][A-Za-z0-9_-]*/g) ?? []).length;
  if (clientTagCount > 1 && client) {
    const clientUpper = client.toUpperCase();
    result = result.replace(/@([A-Za-z][A-Za-z0-9_-]*)/g, (match, tag) =>
      tag.toUpperCase() === clientUpper ? match : "",
    );
  }

  // Pass 4 — reorder leading @tag to end when a #category follows.
  // Annotation pattern "@TAG : content" (colon after tag) is kept in place.
  result = result
    .split("\n")
    .map((line) => {
      const m = /^(@[A-Za-z][A-Za-z0-9_-]*)\s(.*)$/.exec(line);
      if (!m) return line;
      const [, tag, rest] = m;
      if (rest.trimStart().startsWith(":")) return line; // annotation — keep
      if (!/#[A-Za-z]/.test(rest)) return line;          // no #tag present — keep
      return `${rest.trim()} ${tag}`;
    })
    .join("\n");

  // Pass 5
  return result
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .join("\n")
    .trim();
}

// ── Leave / Holiday intercept (Epic 1) ─────────────────────────────────────
// When a task description mentions a time-off keyword, force it into the
// General Work → Others bucket and derive the Work Type from the specific
// keyword ("sick leave" → "Sick Leave", "holiday" → "Holiday"). This is a
// deterministic override applied after parsing, so it works identically for
// the rule parser, the AI parser, and the dynamic hour parser.
//
// Ordered specific-first: multi-word forms ("sick leave") must be tested
// before the bare "leave" fallback, otherwise everything collapses to "Leave".
const LEAVE_WORKTYPES: readonly { re: RegExp; workType: string }[] = [
  { re: /\bsick\s+leave\b/i, workType: "Sick Leave" },
  { re: /\b(?:vacation|annual)\s+leave\b/i, workType: "Vacation Leave" },
  { re: /\bmaternity\s+leave\b/i, workType: "Maternity Leave" },
  { re: /\bpaternity\s+leave\b/i, workType: "Paternity Leave" },
  { re: /\bemergency\s+leave\b/i, workType: "Emergency Leave" },
  { re: /\bbereavement\s+leave\b/i, workType: "Bereavement Leave" },
  { re: /\bholiday\b/i, workType: "Holiday" },
  { re: /\bvacation\b/i, workType: "Vacation Leave" },
  { re: /\bpto\b/i, workType: "PTO" },
  { re: /\bleave\b/i, workType: "Leave" }, // generic — checked last
];

function detectLeaveWorkType(text: string): string | null {
  for (const { re, workType } of LEAVE_WORKTYPES) {
    if (re.test(text)) return workType;
  }
  return null;
}

/** Force any leave/holiday task into General Work → Others with the matched work type. */
function applyLeaveOverride(task: ParsedTask): ParsedTask {
  const workType = detectLeaveWorkType(task.description);
  if (!workType) return task;
  return {
    ...task,
    workCategory: "General Work",
    subCategory: "Others",
    workType,
  };
}

export interface ActivityData {
  id: string;
  team: string;
  workCategory: string;
  /**
   * Phase P: sub category within the main workCategory. Null when
   * the main category has no sub categories defined (HR, IT, General
   * Work, etc. in the default taxonomy) or when the user didn't
   * pick one. Display code should use `workCategory` as the primary
   * grouping label and show `subCategory` as a secondary tag when
   * present.
   */
  subCategory: string | null;
  workType: string;
  client: string;
  description: string;
  percentage: number;
  expanded: boolean;
}

export interface WorkStreamData {
  category: string;
  activities: ActivityData[];
  expanded: boolean;
}

interface WorkspaceProps {
  streams: WorkStreamData[];
  onStreamsChange: (s: WorkStreamData[]) => void;
  locked: boolean;
  grandTotal: number;
  onSubmit: () => void;
  employeeTeam?: string;
  submitLabel?: string;
  disabled?: boolean;
  onAutoGenerate?: () => void;
  showAutoGenerate?: boolean;
  promptText?: string;
  /**
   * True when the current prompt text originated from "Auto-Generate from
   * Daily Journal". Auto-Generate output is normalized to sum to exactly
   * 100% (journal hours rarely add up cleanly); manually typed prompts keep
   * their exact percentages (Epic 1). Cleared by `onPromptEdit`.
   */
  autoGenerated?: boolean;
  /**
   * Persist the submitted prompt text upward so it survives the promptbox
   * unmounting when cards are generated. Lets the text reappear intact if
   * the user clears all cards and returns to the promptbox (Epic 1).
   */
  onPromptTextChange?: (text: string) => void;
  /** Fired when the user manually edits the promptbox — clears `autoGenerated`. */
  onPromptEdit?: () => void;
  /**
   * Per-activity flags from the manager's review, keyed by activity id.
   */
  flags?: Record<string, ActivityFlag>;
}

interface DescriptionFieldProps {
  value: string;
  onChange: (val: string) => void;
}

const DescriptionField = ({ value, onChange }: DescriptionFieldProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const { categories: mainCategories, subCategories } = useClientsConfig();

  const highlightRegex = useMemo(() => {
    const multiWord = [
      ...mainCategories,
      ...subCategories.map((s) => s.name),
    ].filter((n) => /[^A-Za-z0-9]/.test(n));
    return buildHighlightRegex(multiWord);
  }, [mainCategories, subCategories]);

  const taggedContent = useMemo(
    () => renderTagged(value, highlightRegex),
    [value, highlightRegex],
  );

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const bd = backdropRef.current;
    if (!ta || !bd) return;
    bd.scrollTop = ta.scrollTop;
  }, []);

  return (
    <div className="relative rounded-md border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 px-3 py-2 text-sm leading-5 pointer-events-none select-none overflow-hidden text-foreground"
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}
      >
        {taggedContent}
      </div>
      <Textarea
        ref={textareaRef}
        placeholder="Enter description..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        className="relative min-h-[60px] resize-y text-sm border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
        style={{ color: "transparent", caretColor: "hsl(var(--foreground))" }}
      />
    </div>
  );
};

const Workspace = ({
  streams,
  onStreamsChange,
  locked,
  grandTotal,
  onSubmit,
  employeeTeam,
  submitLabel = "Submit Monthly Allocation",
  disabled = false,
  onAutoGenerate,
  showAutoGenerate = false,
  promptText,
  autoGenerated = false,
  onPromptTextChange,
  onPromptEdit,
  flags,
}: WorkspaceProps) => {
  const {
    teams,
    clients,
    categories,
    subCategories,
    subCategoriesForMain,
    workTypes,
    workTypesForParent,
    inferenceRules,
    sharedClientList,
  } = useClientsConfig();
  const { config: aiConfig, isAIAvailable } = useAIConfig();

  // Tracks whether an Auto-Generate call is in flight. Blocks the
  // submit button and shows a loading state. Also tracks whether the
  // result came from AI so the UI can toast accordingly.
  const [aiPending, setAiPending] = useState(false);

  /**
   * Build the parser's TaxonomySnapshot from the live context so
   * prompt text containing `#Geniisys` or `#Projects/Geniisys` tags
   * resolves correctly when parsed here. Pure derivation from the
   * arrays we already have; rebuilds only when the taxonomy changes.
   *
   * Three maps:
   *   - `subCategoryToMain`: sub → its parent main
   *   - `workTypesByParent`: parent → all valid work types
   *     (declaration order preserved for the dropdown UI)
   *   - `defaultWorkTypeByParent`: parent → default work type
   *     chosen with a specialization-preferred ordering: sort the
   *     parent's valid work types by how many parents each has
   *     (ascending), so a work type specific to this parent wins
   *     over a cross-cutting one like Meetings (which lists many
   *     parents). Prevents the bug where `#Geniisys` defaulted to
   *     Meetings just because Meetings appeared first in the seed.
   */
  const taxonomy = useMemo<TaxonomySnapshot>(() => {
    const subCategoryToMain: Record<string, string> = {};
    for (const sub of subCategories) {
      subCategoryToMain[sub.name] = sub.parentMainCategory;
    }
    const defaultWorkTypeByParent: Record<string, string> = {};
    const workTypesByParent: Record<string, string[]> = {};
    for (const main of categories) {
      const subs = subCategoriesForMain(main);
      const parents =
        subs.length === 0 ? [main] : subs.map((s) => s.name);
      for (const p of parents) {
        const validInOrder = workTypes
          .filter((w) => w.parents.includes(p))
          .map((w) => w.name);
        workTypesByParent[p] = validInOrder;

        // Default picks the most specialized work type under this
        // parent — the one with the fewest parents overall.
        // Ties broken by declaration order.
        const sortedBySpecificity = workTypes
          .filter((w) => w.parents.includes(p))
          .slice()
          .sort((a, b) => a.parents.length - b.parents.length);
        if (sortedBySpecificity.length > 0) {
          defaultWorkTypeByParent[p] = sortedBySpecificity[0].name;
        }
      }
    }

    // Scenario A — Project-Client relationship map.
    // Derived from SubCategory.clients[] configured in Admin Settings.
    // The rule parser reads this to fan out a #SubCat entry (with no
    // explicit @client) across every client assigned to that project,
    // splitting the percentage equally.  Only sub-categories that have
    // at least one client configured contribute an entry here.
    const clientsBySubCategory: Record<string, readonly string[]> = {};
    for (const sub of subCategories) {
      if (sub.clients && sub.clients.length > 0) {
        clientsBySubCategory[sub.name] = sub.clients;
      }
    }

    return {
      subCategoryToMain,
      defaultWorkTypeByParent,
      workTypesByParent,
      clientsBySubCategory,
    };
  }, [categories, subCategories, workTypes, subCategoriesForMain]);

  const [deleteTarget, setDeleteTarget] = useState<{
    type: "stream" | "activity";
    streamIdx: number;
    actIdx?: number;
  } | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);

  const showPrompt = streams.length === 0;

  /**
   * Parse the prompt text into structured tasks and merge into streams.
   *
   * Flow:
   *   1. If AI is configured (key present + enabled), call Claude.
   *   2. If AI succeeds, use its classifications.
   *   3. If AI fails (bad key, network, invalid response), log and
   *      fall back to the rule parser with a warning toast.
   *   4. If AI is not configured, silently use the rule parser.
   *
   * The rule parser is no longer the main engine but remains the
   * safety net for when AI isn't available.
   */
  const handleAISubmit = async (text: string) => {
    if (aiPending) return;
    setAiPending(true);

    // Retain the raw prompt upward so it survives this box unmounting once
    // cards are generated — the user can Clear All and find the text intact.
    onPromptTextChange?.(text);

    try {
      const result = await parseWithAI(text, {
        apiKey: isAIAvailable ? aiConfig.apiKey : null,
        model: aiConfig.model,
        defaultTeam: employeeTeam || teams[0],
        knownClients: clients,
        fallbackClient: FALLBACK_CLIENT,
        mainCategories: categories,
        subCategories,
        workTypes,
        taxonomy,
        inferenceRules,
      });

      if (result.aiErrorMessage) {
        toast.warning(
          `AI unavailable — used rule parser. ${result.aiErrorMessage.slice(0, 80)}`,
        );
      } else if (result.source === "ai") {
        toast.success(
          `Generated ${result.tasks.length} ${result.tasks.length === 1 ? "activity" : "activities"} with AI.`,
        );
      }

      if (result.tasks.length === 0) {
        toast.error("We couldn't detect your formatted tasks.", {
          description:
            "Please ensure your lines contain a task item followed by a percentage allocation (e.g., — Development task - 20%).",
        });
        return;
      }

      // Leave/Holiday intercept (Epic 1): reroute any time-off task to
      // General Work → Others before merging into streams.
      const tasks = result.tasks.map(applyLeaveOverride);
      // Percentage scaling (Epic 1): only Auto-Generate output is normalized
      // to 100%. Manually typed prompts keep their exact percentages.
      applyParsedTasks(tasks, autoGenerated);
    } finally {
      setAiPending(false);
    }
  };

  /**
   * Merge ParsedTask results into the stream state. Split out from
   * handleAISubmit so it can be reused by future entry points.
   */
  const applyParsedTasks = (parsed: ParsedTask[], normalizeToHundred = false) => {
    // Normalize percentages so the full set sums to exactly 100.00%.
    // Auto-Generate may produce raw bullets that exceed 100% (multiple
    // overlapping journal entries) or fall short (incomplete logs).
    // We scale proportionally then redistribute rounding error to the
    // largest activity so the total lands exactly at 100.
    //
    // Epic 1: this scaling is applied ONLY to Auto-Generate output. Manually
    // typed prompts keep their exact percentages — the user reconciles to
    // 100% themselves (the grand-total indicator + submit gate enforce it).
    const normalized: ParsedTask[] = (() => {
      if (!normalizeToHundred) return parsed;
      const rawTotal = parsed.reduce((s, p) => s + p.percentage, 0);
      if (parsed.length === 0 || rawTotal === 0) return parsed;
      const scale = 100 / rawTotal;
      const scaled = parsed.map((p) => ({
        ...p,
        percentage: parseFloat((p.percentage * scale).toFixed(2)),
      }));
      // Fix rounding drift: assign delta to the largest activity.
      const drift = parseFloat(
        (100 - scaled.reduce((s, p) => s + p.percentage, 0)).toFixed(2),
      );
      if (drift !== 0 && scaled.length > 0) {
        const largestIdx = scaled.reduce(
          (best, cur, i) => (cur.percentage > scaled[best].percentage ? i : best),
          0,
        );
        scaled[largestIdx] = {
          ...scaled[largestIdx],
          percentage: parseFloat(
            (scaled[largestIdx].percentage + drift).toFixed(2),
          ),
        };
      }
      return scaled;
    })();

    const grouped: Record<string, ParsedTask[]> = {};
    for (const item of normalized) {
      if (!grouped[item.workCategory]) grouped[item.workCategory] = [];
      grouped[item.workCategory].push(item);
    }

    const newStreams = [...streams];
    for (const [category, activities] of Object.entries(grouped)) {
      const existingIdx = newStreams.findIndex((s) => s.category === category);
      const newActivities: ActivityData[] = activities.map((a) => ({
        id: a.id ?? crypto.randomUUID(),
        team: a.team,
        workCategory: a.workCategory,
        subCategory: a.subCategory,
        workType: a.workType,
        client: a.client,
        description: normalizeDescription(a.description, a.client),
        percentage: a.percentage,
        expanded: true,
      }));

      if (existingIdx >= 0) {
        newStreams[existingIdx] = {
          ...newStreams[existingIdx],
          expanded: true,
          activities: [
            ...newStreams[existingIdx].activities,
            ...newActivities,
          ],
        };
      } else {
        newStreams.push({ category, expanded: true, activities: newActivities });
      }
    }

    onStreamsChange(newStreams);
  };

  const removeStream = () => {
    if (!deleteTarget) return;
    const updated = streams.filter((_, i) => i !== deleteTarget.streamIdx);
    onStreamsChange(updated);
    setDeleteTarget(null);
    toast.success("Item deleted.");
  };

  const removeActivity = () => {
    if (!deleteTarget || deleteTarget.actIdx === undefined) return;
    const updated = streams
      .map((s, i) =>
        i === deleteTarget.streamIdx
          ? { ...s, activities: s.activities.filter((_, j) => j !== deleteTarget.actIdx) }
          : s,
      )
      .filter((s) => s.activities.length > 0);
    onStreamsChange(updated);
    setDeleteTarget(null);
    toast.success("Item deleted.");
  };

  const toggleStreamExpand = (idx: number) => {
    onStreamsChange(
      streams.map((s, i) => (i === idx ? { ...s, expanded: !s.expanded } : s)),
    );
  };

  const toggleActivityExpand = (sIdx: number, aIdx: number) => {
    onStreamsChange(
      streams.map((s, si) =>
        si === sIdx
          ? {
              ...s,
              activities: s.activities.map((a, ai) =>
                ai === aIdx ? { ...a, expanded: !a.expanded } : a,
              ),
            }
          : s,
      ),
    );
  };

  const updateActivity = (
    sIdx: number,
    aIdx: number,
    field: keyof ActivityData,
    value: string | number | boolean | null,
  ) => {
    onStreamsChange(
      streams.map((s, si) =>
        si === sIdx
          ? {
              ...s,
              activities: s.activities.map((a, ai) =>
                ai === aIdx ? { ...a, [field]: value } : a,
              ),
            }
          : s,
      ),
    );
  };

  const collapseAll = () => {
    onStreamsChange(
      streams.map((s) => ({
        ...s,
        expanded: false,
        activities: s.activities.map((a) => ({ ...a, expanded: false })),
      })),
    );
  };
  const expandAll = () => {
    onStreamsChange(
      streams.map((s) => ({
        ...s,
        expanded: true,
        activities: s.activities.map((a) => ({ ...a, expanded: true })),
      })),
    );
  };

  // ── Manual card / stream management (Epic 2) ───────────────────────────
  // Blank card: no category yet (the un-hidden Work Category dropdown lets
  // the user classify it), 0% so it never silently inflates the grand total.
  const makeBlankActivity = (workCategory: string): ActivityData => ({
    id: crypto.randomUUID(),
    team: employeeTeam ?? teams[0] ?? "",
    workCategory,
    subCategory: null,
    workType: "",
    client: "",
    description: "",
    percentage: 0,
    expanded: true,
  });

  const addWorkStream = () => {
    // Unique placeholder title so the stream key never collides. The title
    // re-syncs to the chosen category once the user classifies its sole card.
    const base = "New Work Stream";
    let name = base;
    let n = 2;
    while (streams.some((s) => s.category === name)) name = `${base} ${n++}`;
    onStreamsChange([
      ...streams,
      { category: name, expanded: true, activities: [makeBlankActivity("")] },
    ]);
  };

  // Set a stream's category from its title dropdown (manual streams). The
  // category lives on the stream title, so this also stamps every activity in
  // the stream with the chosen category and clears their now-stale sub/work
  // type selections.
  const setStreamCategory = (streamIdx: number, category: string) => {
    onStreamsChange(
      streams.map((s, i) =>
        i === streamIdx
          ? {
              ...s,
              category,
              activities: s.activities.map((a) => ({
                ...a,
                workCategory: category,
                subCategory: null,
                workType: "",
              })),
            }
          : s,
      ),
    );
  };

  const addActivity = (streamIdx: number) => {
    onStreamsChange(
      streams.map((s, i) =>
        i === streamIdx
          ? {
              ...s,
              expanded: true,
              // Inherit the stream's category only when it's a real category;
              // an unclassified manual stream ("New Work Stream") leaves the
              // new card's category blank until the title dropdown is set.
              activities: [
                ...s.activities,
                makeBlankActivity(categories.includes(s.category) ? s.category : ""),
              ],
            }
          : s,
      ),
    );
  };

  const clearAll = () => {
    onStreamsChange([]);
    setClearAllOpen(false);
    toast.success("All work streams cleared.");
  };

  // ── Strict validation ────────────────────────────────────────────────
  // Compute which activity cards are missing required fields. Used to
  // disable the submit button and explain the blocker via toast.
  const incompleteActivities = useMemo(() => {
    const result: { id: string; streamName: string; missing: string[] }[] = [];
    for (const stream of streams) {
      for (const activity of stream.activities) {
        const subsForMain = subCategoriesForMain(activity.workCategory);
        const hasSubs = subsForMain.length > 0;
        const missing: string[] = [];
        if (!activity.workCategory) missing.push("Work Category");
        if (hasSubs && !activity.subCategory) missing.push("Sub Category");
        if (!activity.workType) missing.push("Work Type");
        if (!activity.client) missing.push("Client");
        if (missing.length > 0) {
          result.push({ id: activity.id, streamName: stream.category, missing });
        }
      }
    }
    return result;
  }, [streams, subCategoriesForMain]);

  const incompleteIds = useMemo(
    () => new Set(incompleteActivities.map((i) => i.id)),
    [incompleteActivities],
  );

  const hasIncompleteActivities = incompleteActivities.length > 0;

  // Wrap onSubmit with field-level validation. Called whether or not the
  // grand total is 100 so the user gets a useful error before chasing the %.
  const handleValidatedSubmit = () => {
    if (hasIncompleteActivities) {
      const first = incompleteActivities[0];
      toast.error(
        `Cannot submit: "${first.streamName}" has ${first.missing.join(", ")} missing. All fields are required.`,
      );
      return;
    }
    onSubmit();
  };

  if (locked) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-muted-foreground">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <ChevronRight className="h-8 w-8 opacity-30" />
        </div>
        <p className="text-center max-w-xs">
          Select a Work Period to unlock your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {showPrompt ? (
        <div className="flex flex-col h-full">
          <AIPromptBox
            onSubmit={handleAISubmit}
            isProcessing={aiPending}
            minimized={false}
            initialText={promptText}
            onEdit={onPromptEdit}
            headerSlot={showAutoGenerate && onAutoGenerate ? (
              <>
                <Button
                  variant="outline"
                  className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/5 hover:text-primary shadow-sm shadow-primary/10"
                  onClick={onAutoGenerate}
                >
                  Auto-Generate from Daily Journal
                </Button>
                <div className="flex items-center justify-center gap-4 my-4">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : undefined}
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto space-y-4 pb-24">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  {streams.length} work stream{streams.length !== 1 ? "s" : ""}
                </span>
                {!disabled && (
                  <button
                    onClick={addWorkStream}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add Work Stream
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={expandAll} className="text-primary hover:underline">
                  Expand All
                </button>
                <span className="text-muted-foreground">|</span>
                <button onClick={collapseAll} className="text-primary hover:underline">
                  Collapse All
                </button>
                {!disabled && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <button
                      onClick={() => setClearAllOpen(true)}
                      className="inline-flex items-center gap-1 text-destructive hover:underline"
                    >
                      <Eraser className="h-3 w-3" /> Clear All
                    </button>
                  </>
                )}
              </div>
            </div>

            {streams.map((stream, sIdx) => {
              const subtotal = stream.activities.reduce(
                (sum, a) => sum + a.percentage,
                0,
              );
              // A stream whose title isn't a known main category is a manual
              // stream awaiting classification — render its title as a category
              // dropdown instead of static text.
              const isKnownCategory = categories.includes(stream.category);

              return (
                <div
                  key={`${stream.category}-${sIdx}`}
                  className="glass-card rounded-xl overflow-hidden animate-fade-in"
                >
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors border-l-4 border-l-primary"
                    onClick={() => toggleStreamExpand(sIdx)}
                  >
                    <div className="flex items-center gap-2">
                      {stream.expanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      {!disabled && !isKnownCategory ? (
                        <Select
                          value=""
                          onValueChange={(v) => setStreamCategory(sIdx, v)}
                        >
                          <SelectTrigger
                            onClick={(e) => e.stopPropagation()}
                            className="h-auto w-auto gap-1 border-0 bg-transparent p-0 font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0"
                          >
                            <SelectValue placeholder={stream.category || "New Work Stream"} />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="font-semibold text-foreground">{stream.category}</span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        {stream.activities.length}{" "}
                        {stream.activities.length === 1 ? "activity" : "activities"}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        — {parseFloat(subtotal.toFixed(2))}%
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget({ type: "stream", streamIdx: sIdx });
                      }}
                      className="text-destructive/60 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {stream.expanded && (
                    <div className="px-4 pb-4 space-y-3">
                      {stream.activities.map((activity, aIdx) => {
                        const flag = flags?.[activity.id];
                        const isIncomplete = incompleteIds.has(activity.id);
                        return (
                          <div
                            key={activity.id}
                            className={cn(
                              "border rounded-lg overflow-hidden transition-colors",
                              flag && "border-warning/30 bg-warning/10",
                              isIncomplete && !flag && "border-destructive/40 bg-destructive/5",
                            )}
                          >
                            <div
                              className={cn(
                                "flex items-center justify-between px-3 py-2 cursor-pointer transition-colors",
                                flag
                                  ? "bg-warning/10 hover:bg-warning/15"
                                  : "bg-muted/30 hover:bg-muted/50",
                              )}
                              onClick={() => toggleActivityExpand(sIdx, aIdx)}
                            >
                              <div className="flex items-center gap-2 text-sm min-w-0">
                                {activity.expanded ? (
                                  <ChevronDown className="h-3 w-3 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 shrink-0" />
                                )}
                                <span className="font-medium truncate">
                                  {activity.workType ||
                                    activity.description?.slice(0, 40) ||
                                    "New Activity"}
                                </span>
                                {activity.subCategory && (
                                  <span
                                    className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0"
                                    style={{
                                      background: "hsl(var(--primary-pastel))",
                                      color: "hsl(var(--primary))",
                                      letterSpacing: "0.03em",
                                    }}
                                    title={`Sub category: ${activity.subCategory}`}
                                  >
                                    {activity.subCategory}
                                  </span>
                                )}
                                {activity.workType && activity.description && (
                                  <span className="text-muted-foreground truncate max-w-[200px]">
                                    — {normalizeDescription(activity.description, activity.client).split("\n")[0]}
                                  </span>
                                )}
                                <span className="text-primary font-semibold shrink-0">
                                  {parseFloat(activity.percentage.toFixed(2))}%
                                </span>
                                {flag && (
                                  <Badge
                                    variant="outline"
                                    className="h-5 text-[10px] gap-1 border-destructive/30 bg-destructive/10 text-destructive shrink-0"
                                  >
                                    <Flag className="h-2.5 w-2.5" /> Flagged
                                  </Badge>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget({
                                    type: "activity",
                                    streamIdx: sIdx,
                                    actIdx: aIdx,
                                  });
                                }}
                                className="text-destructive/60 hover:text-destructive shrink-0 ml-2"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {activity.expanded && (
                              <>
                                {flag && (
                                  <div className="px-3 pt-3">
                                    <div className="rounded-md bg-destructive/8 border border-destructive/20 p-3">
                                      <div className="flex items-start gap-2">
                                        <Flag className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                                        <div className="min-w-0">
                                          <p className="text-xs font-semibold text-destructive">
                                            Manager flagged this card
                                          </p>
                                          <p className="text-xs text-foreground/80 mt-0.5 whitespace-pre-line">
                                            {flag.reason}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                <div className="p-3 grid grid-cols-2 gap-3">
                                  {/*
                                    Phase P: the category/work-type dropdowns
                                    honor the three-level taxonomy.
                                      - Main cat changes  → clear sub + work type
                                      - Sub cat changes   → clear work type
                                      - Work Type options filter by the selected
                                        sub (when main has subs) or by the main
                                        (when it doesn't).
                                  */}
                                  {(() => {
                                    const subsForMain = subCategoriesForMain(
                                      activity.workCategory,
                                    );
                                    const hasSubs = subsForMain.length > 0;

                                    // Work type options: filter by the active
                                    // parent (sub if one is selected, else main).
                                    // When main has subs but no sub picked,
                                    // show empty — can't pick a work type yet.
                                    const activeParent = hasSubs
                                      ? activity.subCategory
                                      : activity.workCategory;
                                    const wtOptions = activeParent
                                      ? workTypesForParent(activeParent).map(
                                          (w) => w.name,
                                        )
                                      : [];

                                    return (
                                      <>
                                        {/*
                                          Work Category is set at the stream-
                                          title level (redundant on the card),
                                          so this dropdown stays hidden. Kept in
                                          the tree so the reset-on-change wiring
                                          remains available if ever re-surfaced.
                                        */}
                                        <div className="space-y-1 hidden">
                                          <label className="text-xs font-medium text-muted-foreground">
                                            Work Category
                                          </label>
                                          <Select
                                            value={activity.workCategory}
                                            onValueChange={(v) => {
                                              // Reset sub + work type on main
                                              // change to avoid stale
                                              // cross-hierarchy values.
                                              const next = streams.map(
                                                (s, si) =>
                                                  si === sIdx
                                                    ? {
                                                        ...s,
                                                        activities:
                                                          s.activities.map(
                                                            (a, ai) =>
                                                              ai === aIdx
                                                                ? {
                                                                    ...a,
                                                                    workCategory:
                                                                      v,
                                                                    subCategory:
                                                                      null,
                                                                    workType:
                                                                      "",
                                                                  }
                                                                : a,
                                                          ),
                                                      }
                                                    : s,
                                              );
                                              onStreamsChange(next);
                                            }}
                                          >
                                            <SelectTrigger>
                                              <SelectValue placeholder="Select category..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {categories.map((c) => (
                                                <SelectItem key={c} value={c}>
                                                  {c}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>

                                        {/*
                                          Conditional Sub Category dropdown.
                                          Only shown when the main has sub cats.
                                          When shown, occupies the second column
                                          of row 1 and pushes Work Type to row 2.
                                        */}
                                        {hasSubs && (
                                          <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground">
                                              Sub Category
                                            </label>
                                            <Select
                                              value={
                                                activity.subCategory ?? ""
                                              }
                                              onValueChange={(v) => {
                                                // Reset work type on sub
                                                // change — new sub has
                                                // different valid types.
                                                const next = streams.map(
                                                  (s, si) =>
                                                    si === sIdx
                                                      ? {
                                                          ...s,
                                                          activities:
                                                            s.activities.map(
                                                              (a, ai) =>
                                                                ai === aIdx
                                                                  ? {
                                                                      ...a,
                                                                      subCategory:
                                                                        v,
                                                                      workType:
                                                                        "",
                                                                    }
                                                                  : a,
                                                            ),
                                                        }
                                                      : s,
                                                );
                                                onStreamsChange(next);
                                              }}
                                            >
                                              <SelectTrigger>
                                                <SelectValue placeholder="Select sub category..." />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {subsForMain.map((sub) => (
                                                  <SelectItem
                                                    key={sub.name}
                                                    value={sub.name}
                                                  >
                                                    {sub.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        )}

                                        <div className="space-y-1">
                                          <label className="text-xs font-medium text-muted-foreground">
                                            Work Type
                                          </label>
                                          <Select
                                            value={activity.workType}
                                            onValueChange={(v) =>
                                              updateActivity(
                                                sIdx,
                                                aIdx,
                                                "workType",
                                                v,
                                              )
                                            }
                                            disabled={
                                              hasSubs && !activity.subCategory
                                            }
                                          >
                                            <SelectTrigger>
                                              <SelectValue
                                                placeholder={
                                                  hasSubs &&
                                                  !activity.subCategory
                                                    ? "Select sub category first..."
                                                    : "Select work type..."
                                                }
                                              />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {wtOptions.length === 0 ? (
                                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                                  No work types available for this parent.
                                                </div>
                                              ) : (
                                                wtOptions.map((t) => (
                                                  <SelectItem key={t} value={t}>
                                                    {t}
                                                  </SelectItem>
                                                ))
                                              )}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </>
                                    );
                                  })()}

                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">
                                      Client
                                    </label>
                                    <Select
                                      value={activity.client}
                                      onValueChange={(v) =>
                                        updateActivity(sIdx, aIdx, "client", v)
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select client..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {sharedClientList.map((c) => (
                                          <SelectItem key={c} value={c}>{c}</SelectItem>
                                        ))}
                                        {activity.client &&
                                          !sharedClientList.includes(activity.client) && (
                                            <SelectItem value={activity.client}>
                                              {activity.client} (custom)
                                            </SelectItem>
                                          )}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-muted-foreground">
                                      % Allocated
                                    </label>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={0.01}
                                      value={activity.percentage || ""}
                                      onChange={(e) =>
                                        updateActivity(
                                          sIdx,
                                          aIdx,
                                          "percentage",
                                          parseFloat(e.target.value) || 0,
                                        )
                                      }
                                      placeholder="0.00"
                                    />
                                  </div>

                                  <div className="space-y-1 col-span-2">
                                    <label className="text-xs font-medium text-muted-foreground">
                                      Description
                                    </label>
                                    <DescriptionField
                                      value={normalizeDescription(activity.description, activity.client)}
                                      onChange={(val) => updateActivity(sIdx, aIdx, "description", val)}
                                    />
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        {!disabled ? (
                          <button
                            onClick={() => addActivity(sIdx)}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Plus className="h-3 w-3" /> Add Card Manually
                          </button>
                        ) : (
                          <span />
                        )}
                        <span>
                          Category Subtotal:{" "}
                          <span className="font-semibold text-foreground">
                            {parseFloat(subtotal.toFixed(2))}%
                          </span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {streams.length > 0 && (
        <div className="sticky bottom-0 bg-card border-t p-4 flex items-center justify-between">
          <div className="text-sm">
            Grand Total:{" "}
            <span
              className={`font-bold text-lg ${
                parseFloat(grandTotal.toFixed(2)) === 100
                  ? "text-success"
                  : "text-accent"
              }`}
            >
              {parseFloat(grandTotal.toFixed(2))}%
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            {hasIncompleteActivities && (
              <p className="text-xs text-destructive">
                {incompleteActivities.length}{" "}
                {incompleteActivities.length === 1 ? "card is" : "cards are"}{" "}
                missing required fields
              </p>
            )}
            <Button
              onClick={handleValidatedSubmit}
              disabled={parseFloat(grandTotal.toFixed(2)) !== 100 || disabled || hasIncompleteActivities}
              className="px-8"
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear All Work Streams?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes every generated allocation card and work stream. Your
            prompt text is kept, so you can regenerate. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearAllOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={clearAll}>
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={
                deleteTarget?.type === "stream" ? removeStream : removeActivity
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Workspace;
