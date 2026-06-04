import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useJournal } from "@/contexts/JournalContext";
import type { TimeBlock } from "@/contexts/JournalContext";
import { useClientsConfig } from "@/contexts/ClientsConfigContext";
import {
  useTagAutocomplete,
  type AutocompleteItem,
} from "@/hooks/useTagAutocomplete";
import { useCaretPosition } from "@/hooks/useCaretPosition";
import { TagSuggestPopover } from "@/components/TagSuggestPopover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import WorkspaceTipModal from "@/components/WorkspaceTipModal";
import { buildHighlightRegex, renderTagged } from "@/lib/tagHighlight";
import {
  Save,
  BookOpen,
  Hash,
  AtSign,
  Info,
  CircleAlert,
  Clock,
  Plus,
  Trash2,
  LogOut,
  Lightbulb,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  resolveSmartLines,
  minutesToStr,
  currentTimeStr,
  blockToLineText,
  DEFAULT_END_OF_DAY,
  toHHMM,
  findTimeRange,
  findLeadingTime,
  maskTimeShorthand,
  validateJournalLineTime,
} from "@/lib/timelineParser";
import type { SmartLineInput, LineValidation } from "@/lib/timelineParser";

// ── Editor consolidation ─────────────────────────────────────────────────────
//
// Stored content keeps one row per typed line:
//   9:17am @AAA:
//    - IP Whitelisting
//    - Resolving Connectivity Issues
//   4:12pm
//
// On reload, we DON'T want to show those as four numbered editor rows —
// rows 2 and 3 belong to row 1's time block (no time of their own).
// Consolidate continuation lines (no leading time and no time range)
// onto the preceding time-bearing row using inline `\n`. The
// auto-resizing textarea renders the multi-line content naturally.
//
// Continuation breaks on:
//   - a new time-bearing row (range or leading time)
//   - a time-only row (clock-out marker like "4:12pm")
//   - end of input
//
// A row that has no time AND has no preceding time-bearing row in the
// current group stays as its own row (legacy untimed content like
// bullet-only days).
function consolidateContent(content: string): string[] {
  const rawLines = content.split("\n");
  const result: string[] = [];
  let openIdx = -1; // index in `result` of the current time-bearing row open for continuations

  for (const raw of rawLines) {
    if (!raw.trim()) continue;

    const range = findTimeRange(raw);
    const leading = findLeadingTime(raw);
    const hasTime = !!(range || leading);
    const isTimeOnly =
      !!leading && raw.substring(leading.index + leading.length).trim() === "";

    if (hasTime) {
      // New time-bearing row. A time-only row (clock-out) closes the
      // continuation chain immediately.
      result.push(raw);
      openIdx = isTimeOnly ? -1 : result.length - 1;
      continue;
    }

    // No time info — attach to the open row, or start a fresh one.
    if (openIdx >= 0) {
      result[openIdx] = `${result[openIdx]}\n${raw}`;
    } else {
      result.push(raw);
    }
  }

  return result;
}

// ── Tag extraction ────────────────────────────────────────────────────────────

const CLIENT_TAG_RE = /(?<![A-Za-z0-9])@([A-Za-z][A-Za-z0-9_-]*)/g;
const CATEGORY_TAG_RE = /(?<![A-Za-z0-9])#([A-Za-z][A-Za-z0-9_/-]*)/g;

function extractTokens(
  text: string,
  knownMultiWordTags: readonly string[] = [],
) {
  let processed = text;
  const sorted = [...knownMultiWordTags]
    .filter((n) => n.includes(" "))
    .sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?<![A-Za-z0-9])#${escaped}(?![A-Za-z0-9])`,
      "gi",
    );
    processed = processed.replace(re, "#" + name.replace(/\s+/g, "-"));
  }
  const clients = new Set<string>();
  const categories = new Set<string>();
  for (const m of processed.matchAll(CLIENT_TAG_RE)) clients.add(m[1].toUpperCase());
  for (const m of processed.matchAll(CATEGORY_TAG_RE))
    categories.add(m[1].replace(/-/g, " "));
  return { clients: [...clients], categories: [...categories] };
}

// ── SmartJournalLine ──────────────────────────────────────────────────────────

interface SmartJournalLineProps {
  lineIndex: number;
  text: string;
  durationMinutes: number | null;
  isTimeOnly: boolean;
  validation: LineValidation;
  tagItems: readonly AutocompleteItem[];
  clientItems: readonly AutocompleteItem[];
  autoFocus?: boolean;
  onChange: (text: string) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onDelete: () => void;
}

function SmartJournalLine({
  lineIndex,
  text,
  durationMinutes,
  isTimeOnly,
  validation,
  tagItems,
  clientItems,
  autoFocus,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onDelete,
}: SmartJournalLineProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [caretPixels, setCaretPixels] = useState<{
    top: number;
    left: number;
    lineHeight: number;
  } | null>(null);
  const measureCaret = useCaretPosition();

  // Highlight backdrop — build taxonomy-aware regex from the tagItems prop so
  // multi-word names like "#Quick Policy" are matched as a single token.
  // Skip rendering when the line is invalid (red text) or time-only (mono font)
  // so those states keep their own visual treatment.
  const highlightRegex = useMemo(
    () => buildHighlightRegex(tagItems.filter((i) => i.value.includes(" ")).map((i) => i.value)),
    [tagItems],
  );
  const taggedContent = useMemo(
    () => renderTagged(text, highlightRegex),
    [text, highlightRegex],
  );

  useLayoutEffect(() => {
    if (autoFocus && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }, [autoFocus]);

  // Auto-resize textarea on mount and whenever text changes externally
  // (e.g. when a saved entry is loaded). The onInput handler covers typing;
  // this covers initial render so long lines are visible immediately.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);

  const handleReplace = useCallback(
    (nextValue: string, nextCaret: number) => {
      onChange(nextValue);
      setCaret(nextCaret);
      queueMicrotask(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [onChange],
  );

  const autocomplete = useTagAutocomplete({
    tagItems,
    clientItems,
    value: text,
    caret,
    onReplace: handleReplace,
  });

  useEffect(() => {
    if (!autocomplete.active || !textareaRef.current) {
      setCaretPixels(null);
      return;
    }
    setCaretPixels(
      measureCaret(textareaRef.current, autocomplete.active.start),
    );
  }, [autocomplete.active, measureCaret]);

  const syncCaret = useCallback(() => {
    setCaret(textareaRef.current?.selectionEnd ?? 0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autocomplete.handleKeyDown(e)) return;
      if (e.key === "Enter") {
        // Shift+Enter inserts a newline within the current row
        // (multi-line entries like "@AAA:\n - bullet 1\n - bullet 2").
        // Plain Enter creates a new editor row as before.
        if (e.shiftKey) return;
        e.preventDefault();
        onEnter();
      }
      if (e.key === "Backspace" && text === "") {
        e.preventDefault();
        onBackspaceEmpty();
      }
    },
    [autocomplete, onEnter, onBackspaceEmpty, text],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const rawValue = e.target.value;
      const rawCaret = e.target.selectionEnd ?? rawValue.length;
      // Smart-format shorthand time tokens as the user types.
      // maskTimeShorthand is idempotent on canonical text, so it's safe
      // to run on every keystroke.
      const { text: nextValue, caretPos: nextCaret } = maskTimeShorthand(
        rawValue,
        rawCaret,
      );
      onChange(nextValue);
      setCaret(nextCaret);
      // When masking actually rewrote the value, we need to re-anchor
      // the textarea's selection — the controlled <textarea> would
      // otherwise re-render with the new value and the cursor would
      // land at the end of the new string. queueMicrotask waits for
      // React to flush the value update before we set the range.
      if (nextValue !== rawValue) {
        queueMicrotask(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          ta.setSelectionRange(nextCaret, nextCaret);
        });
      }
    },
    [onChange],
  );

  const hasDuration = durationMinutes !== null && durationMinutes > 0;
  const isInvalid = !validation.valid;

  return (
    // Row wrapper. A faint destructive tint + rounded corners frames the
    // entire row when invalid — visually grouping the input, alert chip,
    // and message into a single coherent state rather than scattering
    // red across the page.
    <div
      className={cn(
        "flex flex-col rounded-lg transition-colors duration-150",
        isInvalid && "bg-destructive/[0.035]",
      )}
    >
      <div className="group flex items-center gap-0 relative min-h-[44px]">
        {/* Line number gutter — softens to a muted red when invalid,
            never the screaming foreground color. */}
        <span
          className={cn(
            "w-7 shrink-0 text-[11px] text-right pr-2 select-none tabular-nums pt-[11px] self-start",
            isInvalid ? "text-destructive/45" : "text-muted-foreground/25",
          )}
        >
          {lineIndex + 1}
        </span>

        {/* Main input area */}
        <div
          className={cn(
            "flex-1 flex items-start border-b transition-colors pb-0.5",
            isInvalid
              ? "border-destructive/25"
              : "border-border/30 group-hover:border-border/60",
          )}
        >
          {/*
            Auto-resizing textarea: starts at 2 rows so multi-word
            entries are visible without scrolling. The onInput handler
            expands the height on every keystroke; the useLayoutEffect
            above re-runs whenever `text` changes externally (e.g. on
            load) so long pre-filled entries are never clipped.
          */}
          {/* Wrap textarea + backdrop in a relative container so the
              absolute backdrop is clipped to the textarea's bounds. */}
          <div className="relative flex-1">
            {/* Highlight backdrop — visible only on normal (non-invalid,
                non-time-only) lines. Must match textarea padding exactly. */}
            {!isInvalid && !isTimeOnly && (
              <div
                ref={backdropRef}
                aria-hidden="true"
                className="absolute inset-0 px-0 py-2.5 text-sm leading-6 pointer-events-none select-none overflow-hidden text-foreground"
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}
              >
                {taggedContent}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onSelect={syncCaret}
              onClick={syncCaret}
              rows={2}
              placeholder={
                lineIndex === 0
                  ? "9:17am @CLIENT #category What you worked on…"
                  : "Continue your log…"
              }
              aria-invalid={isInvalid}
              className={cn(
                "w-full resize-none bg-transparent border-0 px-0 py-2.5 text-sm leading-6",
                "focus:outline-none focus:ring-0 focus-visible:ring-0",
                "placeholder:text-muted-foreground/30 overflow-hidden",
                isTimeOnly && "text-muted-foreground font-mono text-xs",
                isInvalid && "text-destructive/85",
              )}
              style={{
                minHeight: "52px",
                height: "auto",
                // Transparent text lets the backdrop highlights show through.
                // Skip for invalid/time-only lines that have their own colour.
                ...(!isInvalid && !isTimeOnly
                  ? { color: "transparent", caretColor: "hsl(var(--foreground))" }
                  : {}),
              }}
              onInput={(e) => {
                const ta = e.currentTarget;
                ta.style.height = "auto";
                ta.style.height = `${ta.scrollHeight}px`;
              }}
            />
          </div>

          {/*
            Right-side status slot. When invalid we REPLACE the duration
            badge with an alert chip — showing "9h" for a reversed
            "9:00 am - 3:12" range is misleading (it's a fallback
            computed off the leading time, not what the user typed).
            The chip lives in the same coordinate space as the badge so
            the row geometry doesn't shift when validity flips.
          */}
          <div className="shrink-0 flex items-center pt-[10px] ml-2 min-w-[52px] justify-end">
            {isInvalid ? (
              <span
                className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-destructive/10 text-destructive/75"
                aria-hidden="true"
              >
                <CircleAlert className="h-3 w-3" />
              </span>
            ) : (
              hasDuration && (
                <span className="text-[11px] tabular-nums font-medium px-1.5 py-0.5 rounded-md bg-primary/8 text-primary/60 whitespace-nowrap">
                  {minutesToStr(durationMinutes!)}
                </span>
              )
            )}
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={onDelete}
          tabIndex={-1}
          className="ml-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 flex items-center justify-center rounded-lg hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40 self-center"
          aria-label="Delete line"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {/* Autocomplete popover */}
        {autocomplete.active &&
          caretPixels &&
          autocomplete.suggestions.length > 0 && (
            <TagSuggestPopover
              items={autocomplete.suggestions}
              activeIndex={autocomplete.activeIndex}
              trigger={autocomplete.active.trigger}
              top={caretPixels.top}
              left={caretPixels.left}
              lineHeight={caretPixels.lineHeight}
              onHover={autocomplete.setActiveIndex}
              onSelect={(idx) => autocomplete.acceptSuggestion(idx)}
            />
          )}
      </div>

      {/*
        Inline validation message — rendered as a self-contained pill
        rather than free-floating red text so it reads as a deliberate
        status indicator. Left-aligned with the input column (pl-9
        skips the gutter); the right padding keeps it inside the row
        background so it doesn't look amputated against the page edge.
      */}
      {isInvalid && validation.reason && (
        <div className="pl-9 pr-3 pb-2 pt-0.5">
          <span
            role="alert"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive/85 leading-none"
          >
            <span
              className="inline-block h-1 w-1 rounded-full bg-destructive/60"
              aria-hidden="true"
            />
            {validation.reason}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted/50 border border-border/40 flex items-center justify-center">
        <BookOpen className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <div className="max-w-xs">
        <p className="text-sm font-medium text-foreground">Start your journal</p>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          Write naturally. Lead with a time like{" "}
          <span className="font-mono text-foreground/70">9:17am</span> for
          timeline mode, or write a range like{" "}
          <span className="font-mono text-foreground/70">9:17am to 4:12pm</span>
          . Use{" "}
          <span className="font-mono text-foreground/70">@CLIENT</span> and{" "}
          <span className="font-mono text-foreground/70">#category</span> to
          tag your work.
        </p>
      </div>
      <Button onClick={onAdd} variant="outline" size="sm" className="gap-2">
        <Plus className="h-3.5 w-3.5" />
        Start Writing
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const DailyJournal = () => {
  const { currentUser } = useAuth();
  const { getEntry, saveEntry, getDatesWithEntries } = useJournal();
  const { mainCategories, subCategories, clients } = useClientsConfig();

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const employeeId = currentUser?.id ?? "";
  const dateKey = format(selectedDate, "yyyy-MM-dd");
  const entry = employeeId ? getEntry(employeeId, dateKey) : undefined;

  // ── Lines state ─────────────────────────────────────────────────────

  const entryToLines = useCallback(
    (e: typeof entry): SmartLineInput[] => {
      if (!e) return [];
      // Reconstruct editor rows from raw content, but group continuation
      // lines (no time of their own) onto the preceding time-bearing row.
      // See `consolidateContent` above for the grouping rules.
      //
      // Why NOT load from e.blocks:
      //   derivedBlocks filters out time-only lines (clock-out markers)
      //   because they carry no duration. If we reconstructed from blocks,
      //   clock-out lines like "4:12pm" would vanish on the first save/
      //   reload cycle. content remains the authoritative source.
      return consolidateContent(e.content).map((l) => ({
        id: crypto.randomUUID(),
        text: l,
      }));
    },
    [],
  );

  const [lines, setLines] = useState<SmartLineInput[]>(() =>
    entryToLines(entry),
  );
  const [focusId, setFocusId] = useState<string | null>(null);

  // isDirty compares current editor lines against what was last saved.
  // Must mirror the entryToLines logic above — both sides are the
  // CONSOLIDATED list of editor rows (continuation lines folded into
  // their parent time-bearing row). Otherwise a freshly loaded entry
  // would always show as dirty because the stored side preserved every
  // newline while the editor side collapsed them.
  const storedJson = JSON.stringify(
    entry ? consolidateContent(entry.content) : [],
  );
  const linesJson = JSON.stringify(lines.map((l) => l.text));
  const isDirty = linesJson !== storedJson;

  // Sync when stored entry changes (date switch / external save).
  useEffect(() => {
    if (!isDirty) setLines(entryToLines(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedJson]);

  // ── Autocomplete sources ─────────────────────────────────────────────

  const tagItems = useMemo<AutocompleteItem[]>(() => {
    const items: AutocompleteItem[] = [];
    for (const main of mainCategories)
      items.push({ value: main, label: main, sublabel: "main" });
    for (const sub of subCategories)
      items.push({
        value: sub.name,
        label: sub.name,
        sublabel: sub.parentMainCategory,
      });
    items.sort((a, b) => a.label.localeCompare(b.label));
    return items;
  }, [mainCategories, subCategories]);

  const clientItems = useMemo<AutocompleteItem[]>(
    () =>
      [...clients]
        .sort((a, b) => a.localeCompare(b))
        .map((c) => ({ value: c, label: c })),
    [clients],
  );

  // ── Timeline resolution ──────────────────────────────────────────────

  const resolvedLines = useMemo(
    () => resolveSmartLines(lines, DEFAULT_END_OF_DAY),
    [lines],
  );

  const totalMinutes = useMemo(
    () =>
      resolvedLines.reduce((sum, l) => sum + (l.durationMinutes ?? 0), 0),
    [resolvedLines],
  );

  // ── Per-line validation ──────────────────────────────────────────────
  //
  // Strict pre-save validation. Lines that contain malformed time
  // attempts ("912am", "25:00am") or logically reversed ranges
  // ("9:00 am - 8:00 am") are flagged inline AND block Save Entry.
  // This is the safety net behind input masking — masking refuses to
  // expand impossible inputs, validation surfaces them.
  const lineValidations = useMemo(
    () => lines.map((l) => validateJournalLineTime(l.text)),
    [lines],
  );
  const allLinesValid = useMemo(
    () => lineValidations.every((v) => v.valid),
    [lineValidations],
  );

  // ── Derive TimeBlocks for saving ─────────────────────────────────────
  //
  // A timed line owns a TimeBlock. Lines that follow with NO time info
  // (continuation lines — typically bullets or wrapped text from a
  // multi-line entry like:
  //
  //   9:17am @AAA:
  //    - IP Whitelisting
  //    - Resolving Connectivity Issues
  //
  // ) get joined into the preceding timed block's description with
  // newlines preserved. Without this, the bullet rows were dropped from
  // `derivedBlocks` (they had no startTime/endTime) and the monthly
  // aggregation only saw the first line "@AAA:" — silently truncating
  // the entry.
  //
  // Continuations attach until we hit the next timed line, a time-only
  // clock-out marker, or end of list.

  const derivedBlocks = useMemo<TimeBlock[]>(() => {
    const blocks: TimeBlock[] = [];
    let current: TimeBlock | null = null;

    for (const l of resolvedLines) {
      const hasTime = !!(l.leadingTime || l.timeRange);

      if (hasTime && !l.isTimeOnly && l.startTime && l.endTime) {
        // Start a new block. Strip the leading timestamp so
        // blockToLineText can re-prepend it cleanly on reload.
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
        // Clock-out marker breaks the continuation chain — anything
        // after it belongs to a future block.
        current = null;
        continue;
      }

      if (!hasTime && current && l.text.trim()) {
        // Continuation line — attach to the current block's description
        // with a real newline so multi-line entries survive round-tripping
        // through aggregation and display intact.
        current.description = current.description
          ? `${current.description}\n${l.text.trim()}`
          : l.text.trim();
      }
    }

    return blocks;
  }, [resolvedLines]);

  // ── Other derived ────────────────────────────────────────────────────

  const datesWithEntries = useMemo(
    () => (employeeId ? getDatesWithEntries(employeeId) : new Set<string>()),
    [employeeId, getDatesWithEntries],
  );

  const knownTagNames = useMemo(
    () => [...mainCategories, ...subCategories.map((s) => s.name)],
    [mainCategories, subCategories],
  );

  const combinedText = useMemo(
    () => lines.map((l) => l.text).join("\n"),
    [lines],
  );

  const tokens = useMemo(
    () => extractTokens(combinedText, knownTagNames),
    [combinedText, knownTagNames],
  );

  // ── Unmapped-tag detection ───────────────────────────────────────────
  //
  // Compare each detected @CLIENT / #category against the verified
  // taxonomy. Unmapped tags still flow through to the allocation card
  // (the parser honors explicit @tags verbatim — see promptParser
  // simple-format branch), but we surface them inline so the user
  // knows the tag wasn't in the registered list. No DB writes happen;
  // an Admin can later register the tag via Admin Settings.
  //
  // Comparison is case-insensitive for clients (codes are conventionally
  // uppercase but users type freely) and case-insensitive for
  // categories (the known list mixes cases, e.g. "BD/Mktg/Sales").
  const unmappedClients = useMemo(() => {
    const known = new Set(clients.map((c) => c.toUpperCase()));
    return tokens.clients.filter((c) => !known.has(c.toUpperCase()));
  }, [tokens.clients, clients]);

  const unmappedCategories = useMemo(() => {
    const known = new Set(knownTagNames.map((t) => t.toLowerCase()));
    return tokens.categories.filter((c) => !known.has(c.toLowerCase()));
  }, [tokens.categories, knownTagNames]);

  const hasUnmapped =
    unmappedClients.length > 0 || unmappedCategories.length > 0;

  // ── Line CRUD ─────────────────────────────────────────────────────────

  const addLine = useCallback((afterIndex?: number, prefillText = "") => {
    const newId = crypto.randomUUID();
    setLines((prev) => {
      const next = [...prev];
      const insertAt =
        afterIndex !== undefined ? afterIndex + 1 : next.length;
      next.splice(insertAt, 0, { id: newId, text: prefillText });
      return next;
    });
    setFocusId(newId);
  }, []);

  const updateLine = useCallback((id: string, text: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, text } : l)));
  }, []);

  const deleteLine = useCallback(
    (id: string) => {
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.id === id);
        const next = prev.filter((l) => l.id !== id);
        // Focus the line above (or below if it was the first)
        const focusTarget = next[Math.max(0, idx - 1)];
        if (focusTarget) setFocusId(focusTarget.id);
        return next;
      });
    },
    [],
  );

  // Clear one-shot focus signal after it fires.
  useEffect(() => {
    if (focusId) setFocusId(null);
  }, [focusId]);

  // ── Clock Out ────────────────────────────────────────────────────────

  const lastResolvedWithTime = useMemo(() => {
    for (let i = resolvedLines.length - 1; i >= 0; i--) {
      if (resolvedLines[i].leadingTime || resolvedLines[i].timeRange)
        return resolvedLines[i];
    }
    return null;
  }, [resolvedLines]);

  const canClockOut = lastResolvedWithTime !== null && !lastResolvedWithTime.isTimeOnly;

  const handleClockOut = useCallback(() => {
    const timeStr = currentTimeStr();
    addLine(lines.length - 1, timeStr);
  }, [addLine, lines.length]);

  // ── Date navigation ──────────────────────────────────────────────────

  const handleDateSelect = (date: Date | undefined) => {
    if (!date || !employeeId) return;
    // Only auto-save on date-switch when every line is valid — otherwise
    // the invalid content would silently persist past the validation gate.
    if (isDirty && allLinesValid) {
      const content = lines.map((l) => l.text).filter(Boolean).join("\n");
      saveEntry(employeeId, dateKey, content, derivedBlocks);
    }
    setSelectedDate(date);
    const key = format(date, "yyyy-MM-dd");
    const existing = getEntry(employeeId, key);
    setLines(entryToLines(existing));
  };

  // ── Save ─────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (!employeeId) return;
    // Defense-in-depth: the Save button is disabled when invalid, but
    // we re-check here in case the handler is triggered via keyboard
    // shortcut or a future code path that bypasses the button.
    if (!allLinesValid) {
      toast.error("Cannot save journal", {
        description: "Fix the highlighted time entries first.",
      });
      return;
    }
    const content = lines.map((l) => l.text).filter(Boolean).join("\n");
    saveEntry(employeeId, dateKey, content, derivedBlocks);
    toast.success("Journal saved", {
      description: format(selectedDate, "MMMM d, yyyy"),
    });
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
    <WorkspaceTipModal
      storageKey="hideDailyLogTip"
      title="How to use the Daily Journal"
      subtitle="Log your work day as natural text — no forms, no timers."
      note="You can view these tips at any time by clicking the 'Tips' button next to the Save Entry button."
      tips={[
        {
          heading: "Use tagging shortcuts",
          body: "To ensure the system understands your log clearly, use tagging shortcuts (e.g., @ClientName and #CategoryName) when logging a project or client.",
        },
        {
          heading: "Timeline entries",
          body: 'Start a line with a time like "9:17am @ClientName #CategoryName – description" to record a timed block. Use @ for clients and # for categories.',
        },
        {
          heading: "Range entries",
          body: 'Write "9:00am to 11:30am @Client #Category – task" to span a specific window. The engine converts it to a time block automatically.',
        },
        {
          heading: "Multi-line continuation",
          body: "Lines without a timestamp extend the previous timed block. Great for listing sub-tasks under one work window.",
        },
        {
          heading: "Auto-inference",
          body: "Unrecognised @tags and #tags are flagged with a warning badge. An admin can map them in Settings so future entries resolve correctly.",
        },
      ]}
    />
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* ── Left: Calendar sidebar ── */}
      <div className="w-[340px] border-r bg-secondary/30 p-6 flex flex-col gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Daily Journal</h2>
        </div>

        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          className={cn("p-3 pointer-events-auto rounded-xl border bg-card")}
          modifiers={{
            hasEntry: (date) =>
              datesWithEntries.has(format(date, "yyyy-MM-dd")),
          }}
          modifiersClassNames={{
            hasEntry:
              "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1.5 after:h-1.5 after:rounded-full after:bg-primary",
          }}
        />

        <div className="text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span>Days with logged entries</span>
          </div>
        </div>

        {/* Date summary card */}
        <div className="mt-auto glass-card rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Selected Date</p>
          <p className="text-lg font-semibold text-foreground">
            {format(selectedDate, "EEEE")}
          </p>
          <p className="text-sm text-muted-foreground">
            {format(selectedDate, "MMMM d, yyyy")}
          </p>
          {totalMinutes > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {minutesToStr(totalMinutes)}
              </span>
              <span className="text-xs text-muted-foreground">logged</span>
            </div>
          )}

          {/* Timeline mode hint */}
          {lines.length > 0 && lastResolvedWithTime?.leadingTime && (
            <div className="mt-3 pt-3 border-t border-border/40">
              <p className="text-[11px] text-muted-foreground">
                Timeline mode · End of day{" "}
                <span className="font-mono text-foreground/60">
                  {toHHMM(DEFAULT_END_OF_DAY)}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Journal editor ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-6 pb-4 shrink-0 border-b border-border/30">
          <div>
            <h3 className="text-xl font-semibold text-foreground">
              {format(selectedDate, "MMMM d, yyyy")}
            </h3>
            <p className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
              {entry
                ? `Last saved ${format(new Date(entry.updatedAt), "h:mm a")}`
                : "No entry yet — start writing below"}
              {isDirty && (
                <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                  <CircleAlert className="h-3.5 w-3.5" /> Unsaved
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                >
                  <Info className="h-4 w-4" />
                  Tips
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 text-left">
                <p className="font-semibold text-sm">Smart Journal Format</p>
                <div className="mt-3 space-y-3 text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground mb-1">Timeline mode</p>
                    <p>Each line starts with a timestamp. Duration is the gap to the next line.</p>
                    <pre className="mt-1.5 rounded-md bg-muted/60 border border-border/40 p-2.5 font-mono leading-relaxed whitespace-pre">
{`9:17am @AUII #Geniisys sprint work
4:12pm @UCPB code review #Projects
6:25pm`}
                    </pre>
                    <p className="mt-1 text-[11px]">Line 1: 6h 55m · Line 2: 2h 13m · Last line is end-marker.</p>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Explicit range mode</p>
                    <pre className="mt-1 rounded-md bg-muted/60 border border-border/40 p-2.5 font-mono leading-relaxed">
{`9:24am to 3:26pm @AUII #IT migration
09:24 - 15:26 sprint planning #Projects`}
                    </pre>
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Tagging</p>
                    <p>
                      Type <span className="font-mono text-foreground">@</span>{" "}
                      for client or <span className="font-mono text-foreground">#</span> for category — a suggestion popover appears.
                    </p>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              onClick={handleSave}
              disabled={!isDirty || !employeeId || !allLinesValid}
              className="gap-2"
              title={
                !allLinesValid
                  ? "Fix the highlighted time entries before saving"
                  : undefined
              }
            >
              <Save className="h-4 w-4" /> Save Entry
            </Button>
          </div>
        </div>

        {/* Stats row */}
        {totalMinutes > 0 && (
          <div className="flex items-center gap-3 px-8 py-2.5 border-b border-border/20 bg-muted/20 shrink-0">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {minutesToStr(totalMinutes)}
            </span>
            <span className="text-xs text-muted-foreground">total logged</span>
            <div className="h-3 w-px bg-border/50" />
            <span className="text-xs text-muted-foreground">
              {derivedBlocks.length} timed{" "}
              {derivedBlocks.length === 1 ? "entry" : "entries"}
            </span>
          </div>
        )}

        {/* Journal lines */}
        <div className="flex-1 overflow-y-auto min-h-0 px-8 py-5">
          {lines.length === 0 ? (
            <EmptyState onAdd={() => addLine()} />
          ) : (
            <div className="max-w-3xl">
              {resolvedLines.map((rl, i) => (
                <SmartJournalLine
                  key={rl.id}
                  lineIndex={i}
                  text={rl.text}
                  durationMinutes={rl.durationMinutes}
                  isTimeOnly={rl.isTimeOnly}
                  validation={
                    lineValidations[i] ?? { valid: true, reason: null }
                  }
                  tagItems={tagItems}
                  clientItems={clientItems}
                  autoFocus={focusId === rl.id}
                  onChange={(text) => updateLine(rl.id, text)}
                  onEnter={() => addLine(i)}
                  onBackspaceEmpty={() => deleteLine(rl.id)}
                  onDelete={() => deleteLine(rl.id)}
                />
              ))}

              {/* Footer actions */}
              <div className="flex items-center gap-3 mt-4 pt-3">
                <button
                  onClick={() => addLine(lines.length - 1)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add line
                </button>

                {canClockOut && (
                  <>
                    <span className="h-3 w-px bg-border/40" />
                    <button
                      onClick={handleClockOut}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-primary/70 transition-colors"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Clock out ({currentTimeStr()})
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Detected tags strip */}
        {(tokens.clients.length > 0 || tokens.categories.length > 0) && (
          <TooltipProvider delayDuration={150}>
            <div className="px-8 py-3 border-t border-border/30 bg-muted/10 flex flex-wrap items-center gap-2 shrink-0">
              <span className="text-[11px] text-muted-foreground/60 mr-1">
                Detected:
              </span>
              {tokens.clients.map((c) => {
                const isUnmapped = unmappedClients.includes(c);
                const badge = (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "gap-1 text-[11px]",
                      isUnmapped
                        ? "bg-amber-100/70 text-amber-800 hover:bg-amber-100 border-amber-300 cursor-help"
                        : "bg-primary/8 text-primary/70 hover:bg-primary/12 border-primary/15",
                    )}
                  >
                    <AtSign className="h-2.5 w-2.5" />
                    {c}
                    {isUnmapped && <Lightbulb className="h-2.5 w-2.5 ml-0.5" />}
                  </Badge>
                );
                // shadcn Badge is a plain function component (no
                // forwardRef), so Radix's <TooltipTrigger asChild> can't
                // attach pointer handlers via Slot. Wrap in an inline-flex
                // span so the ref lands on a real DOM node.
                return isUnmapped ? (
                  <Tooltip key={`c-${c}`}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">{badge}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs">
                        <span className="font-semibold">@{c}</span> isn't in the
                        registered client list. It'll still appear on your
                        allocation card as a custom client &mdash; ask an
                        admin to register it under{" "}
                        <span className="font-mono">Settings → Clients</span>{" "}
                        to enable autocomplete.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={`c-${c}`}>{badge}</span>
                );
              })}
              {tokens.categories.map((c) => {
                const isUnmapped = unmappedCategories.includes(c);
                const badge = (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "gap-1 text-[11px]",
                      isUnmapped
                        ? "bg-amber-100/70 text-amber-800 hover:bg-amber-100 border-amber-300 cursor-help"
                        : "bg-accent/8 text-accent/70 hover:bg-accent/12 border-accent/15",
                    )}
                  >
                    <Hash className="h-2.5 w-2.5" />
                    {c}
                    {isUnmapped && <Lightbulb className="h-2.5 w-2.5 ml-0.5" />}
                  </Badge>
                );
                return isUnmapped ? (
                  <Tooltip key={`k-${c}`}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">{badge}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs">
                        <span className="font-semibold">#{c}</span> isn't a
                        registered category. The allocation card will fall
                        back to keyword-based classification &mdash; ask an
                        admin to add it under{" "}
                        <span className="font-mono">
                          Settings → Categories
                        </span>{" "}
                        for a precise match.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={`k-${c}`}>{badge}</span>
                );
              })}
              {hasUnmapped && (
                <span className="ml-auto text-[11px] text-amber-700 flex items-center gap-1">
                  <Lightbulb className="h-3 w-3" />
                  {unmappedClients.length + unmappedCategories.length} unmapped
                  &mdash; hover for details
                </span>
              )}
            </div>
          </TooltipProvider>
        )}
      </div>
    </div>
    </>
  );
};

export default DailyJournal;
