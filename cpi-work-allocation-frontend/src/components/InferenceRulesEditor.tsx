import { useState, useMemo, useEffect } from "react";
import { Plus, Trash2, Save, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClientsConfig } from "@/contexts/ClientsConfigContext";
import { toast } from "sonner";
import type { InferenceRule } from "@/lib/promptParser";

/**
 * UI shape for an inference rule being edited. Keywords are held as
 * a free-text string (comma-separated) for easier editing, parsed to
 * a string[] only when saving. A local client id keeps React keys
 * stable across reorders/deletes.
 *
 * Phase P: subCategory is an optional second-level targeting field.
 * Null means "this rule applies at the main category level" (the
 * default pre-Phase-P behavior). A value means "this rule produces
 * a specific sub category when it fires" — useful for rules like
 * keyword 'geniisys' → (Projects, Geniisys, Implementation).
 */
interface DraftRule {
  clientId: string;
  keywordsText: string;
  category: string;
  subCategory: string | null;
  workType: string;
}

const toDraft = (rule: InferenceRule, idx: number): DraftRule => ({
  clientId: `rule-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  keywordsText: rule.keywords.join(", "),
  category: rule.category,
  subCategory: rule.subCategory ?? null,
  workType: rule.workType,
});

const draftsEqual = (
  a: readonly DraftRule[],
  b: readonly DraftRule[],
): boolean => {
  if (a.length !== b.length) return false;
  return a.every((r, i) =>
    r.keywordsText === b[i].keywordsText &&
    r.category === b[i].category &&
    r.subCategory === b[i].subCategory &&
    r.workType === b[i].workType,
  );
};

const parseKeywords = (text: string): string[] =>
  text
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

/**
 * Editor for the parser's inference rules. Rules are edited as a
 * staged local list and committed atomically on Save — matches the
 * context's updateInferenceRules(rules[]) contract.
 *
 * UX:
 *   - Each rule is a row with: keywords input, category dropdown,
 *     work-type dropdown (filtered by category), delete button.
 *   - Rules without keywords or without a category are invalid;
 *     Save is disabled while any rule is invalid.
 *   - Reset button discards staged changes and reloads from context.
 */
const InferenceRulesEditor = () => {
  const {
    categories,
    workTypesByCategory,
    subCategoriesForMain,
    workTypesForParent,
    inferenceRules,
    updateInferenceRules,
  } = useClientsConfig();

  // Baseline = last-committed rules reshaped for editing. Recomputed
  // whenever context rules change (after a Save or a Reset).
  const baseline = useMemo(
    () => inferenceRules.map(toDraft),
    [inferenceRules],
  );

  const [drafts, setDrafts] = useState<DraftRule[]>(baseline);

  // Keep local drafts in sync when the context rules change from
  // outside this component (another admin session, future persistence
  // rehydration). We re-baseline only when the drafts match the old
  // baseline — i.e. the user has no unsaved work to clobber.
  useEffect(() => {
    setDrafts((current) =>
      draftsEqual(current, baseline) ? baseline : current,
    );
  }, [baseline]);

  const isDirty = !draftsEqual(drafts, baseline);

  // Validation — empty keywords or empty category = invalid.
  const invalidCount = useMemo(() => {
    let n = 0;
    for (const r of drafts) {
      if (parseKeywords(r.keywordsText).length === 0) n++;
      else if (!r.category) n++;
    }
    return n;
  }, [drafts]);

  const canSave = isDirty && invalidCount === 0;

  const updateDraft = (
    clientId: string,
    patch: Partial<Omit<DraftRule, "clientId">>,
  ) => {
    setDrafts((prev) =>
      prev.map((r) => {
        if (r.clientId !== clientId) return r;
        const next = { ...r, ...patch };

        // Cascade reset on main category change. New main may have
        // sub cats → old sub cat is invalid. Also work type scope
        // changes. Clear both downstream fields.
        if (patch.category !== undefined && patch.category !== r.category) {
          next.subCategory = null;
          const subsForNew = subCategoriesForMain(patch.category);
          // If new main has no subs, work type options filter by main
          // directly. Otherwise work type stays empty until a sub is
          // picked (cascade below).
          const activeParent =
            subsForNew.length === 0 ? patch.category : null;
          const valid = activeParent
            ? workTypesForParent(activeParent).map((w) => w.name)
            : [];
          if (!valid.includes(next.workType)) {
            next.workType = valid[0] ?? "";
          }
        }

        // Cascade reset on sub category change.
        if (
          patch.subCategory !== undefined &&
          patch.subCategory !== r.subCategory
        ) {
          const activeParent = patch.subCategory ?? next.category;
          const valid = activeParent
            ? workTypesForParent(activeParent).map((w) => w.name)
            : [];
          if (!valid.includes(next.workType)) {
            next.workType = valid[0] ?? "";
          }
        }

        return next;
      }),
    );
  };

  const removeDraft = (clientId: string) => {
    setDrafts((prev) => prev.filter((r) => r.clientId !== clientId));
  };

  const addDraft = () => {
    const firstCategory = categories[0] ?? "";
    const firstWorkType = workTypesByCategory[firstCategory]?.[0] ?? "";
    setDrafts((prev) => [
      ...prev,
      {
        clientId: `rule-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        keywordsText: "",
        category: firstCategory,
        subCategory: null,
        workType: firstWorkType,
      },
    ]);
  };

  const handleSave = () => {
    const rules: InferenceRule[] = drafts.map((r) => ({
      keywords: parseKeywords(r.keywordsText),
      category: r.category,
      // Only emit subCategory when one was chosen. Omitting the field
      // (vs sending null) keeps the persisted shape minimal and
      // matches the pre-Phase-P format for unchanged rules.
      ...(r.subCategory ? { subCategory: r.subCategory } : {}),
      workType: r.workType,
    }));
    updateInferenceRules(rules);
    toast.success(
      `Saved ${rules.length} inference ${rules.length === 1 ? "rule" : "rules"}.`,
    );
  };

  const handleReset = () => {
    setDrafts(baseline);
    toast.info("Reverted to last saved rules.");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary leading-relaxed">
        <p className="font-semibold mb-1">How inference rules work</p>
        <p className="text-primary/90">
          When a daily journal entry has no <code className="px-1 py-0.5 rounded bg-primary/10 font-mono">#Category</code> tag,
          the parser scans it for keywords and picks the highest-scoring rule
          below. Order matters only for ties. Keywords are matched
          case-insensitively with word boundaries.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{drafts.length}</span>{" "}
          {drafts.length === 1 ? "rule" : "rules"}
          {invalidCount > 0 && (
            <>
              {" · "}
              <span className="text-destructive font-medium">
                {invalidCount} invalid
              </span>
            </>
          )}
          {isDirty && (
            <>
              {" · "}
              <span className="text-amber-600 font-medium">Unsaved changes</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={handleReset}
            disabled={!isDirty}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button
            size="sm"
            className="gap-1"
            onClick={handleSave}
            disabled={!canSave}
          >
            <Save className="h-3.5 w-3.5" /> Save Rules
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {drafts.map((rule) => {
          const kwCount = parseKeywords(rule.keywordsText).length;
          const invalid = kwCount === 0 || !rule.category;
          const subsForMain = subCategoriesForMain(rule.category);
          const hasSubs = subsForMain.length > 0;
          // Work type options scope by the active parent — the sub
          // when present, the main otherwise. Matches the same rule
          // Workspace + ReviewEditor use.
          const activeParent = hasSubs
            ? rule.subCategory
            : rule.category;
          const workTypes = activeParent
            ? workTypesForParent(activeParent).map((w) => w.name)
            : [];

          return (
            <div
              key={rule.clientId}
              className={`grid grid-cols-12 gap-2 items-start p-3 rounded-lg border bg-card ${
                invalid ? "border-destructive/40 bg-destructive/5" : "border-border"
              }`}
            >
              <div className="col-span-5 space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Keywords{" "}
                  {kwCount > 0 && (
                    <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1.5">
                      {kwCount}
                    </Badge>
                  )}
                </label>
                <Input
                  value={rule.keywordsText}
                  onChange={(e) =>
                    updateDraft(rule.clientId, { keywordsText: e.target.value })
                  }
                  placeholder="comma, separated, keywords"
                  className="text-sm font-mono"
                />
                {kwCount === 0 && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> At least one keyword required
                  </p>
                )}
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Category
                </label>
                <Select
                  value={rule.category}
                  onValueChange={(v) => updateDraft(rule.clientId, { category: v })}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Select..." />
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

              <div className="col-span-2 space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Sub Category
                </label>
                {hasSubs ? (
                  <Select
                    value={rule.subCategory ?? ""}
                    onValueChange={(v) =>
                      updateDraft(rule.clientId, {
                        subCategory: v === "__none__" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Sentinel "any" option — rule applies at main-
                          category level, any sub cat under it. */}
                      <SelectItem value="__none__">Any (main-level)</SelectItem>
                      {subsForMain.map((sub) => (
                        <SelectItem key={sub.name} value={sub.name}>
                          {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-9 flex items-center px-2 rounded-md bg-muted/40 text-[11px] text-muted-foreground">
                    N/A
                  </div>
                )}
              </div>

              <div className="col-span-2 space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Work Type
                </label>
                <Select
                  value={rule.workType}
                  onValueChange={(v) => updateDraft(rule.clientId, { workType: v })}
                  disabled={workTypes.length === 0}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder={hasSubs && !rule.subCategory ? "Pick sub first" : "—"} />
                  </SelectTrigger>
                  <SelectContent>
                    {workTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-1 flex justify-end pt-[22px]">
                <button
                  onClick={() => removeDraft(rule.clientId)}
                  className="text-destructive/60 hover:text-destructive transition-colors p-1.5"
                  aria-label="Delete rule"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}

        <Button
          variant="outline"
          className="w-full gap-1 border-dashed"
          onClick={addDraft}
        >
          <Plus className="h-4 w-4" /> Add Rule
        </Button>
      </div>
    </div>
  );
};

export default InferenceRulesEditor;
