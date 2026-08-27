import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { ArrowUp, Loader2, Info } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useTagAutocomplete,
  type AutocompleteItem,
} from "@/hooks/useTagAutocomplete";
import { useCaretPosition } from "@/hooks/useCaretPosition";
import { TagSuggestPopover } from "@/components/TagSuggestPopover";
import { useClientsConfig } from "@/contexts/ClientsConfigContext";
import {
  buildHighlightRegex,
  renderTagged,
  ENHANCEMENT_SIGIL,
} from "@/lib/tagHighlight";

interface AIPromptBoxProps {
  onSubmit: (text: string) => void;
  isProcessing: boolean;
  minimized: boolean;
  initialText?: string;
  /**
   * Fired whenever the user manually edits the textarea (typing / paste).
   * NOT fired for programmatic `initialText` seeding. Used by the parent to
   * mark the prompt as "manually authored" so it is no longer treated as
   * Auto-Generate output (percentage normalization differs — see Workspace).
   */
  onEdit?: () => void;
  /** Rendered above the heading inside the centering wrapper so all content centers as a group. */
  headerSlot?: ReactNode;
}

const AIPromptBox = ({
  onSubmit,
  isProcessing,
  minimized,
  initialText,
  onEdit,
  headerSlot,
}: AIPromptBoxProps) => {
  const [text, setText] = useState(initialText ?? "");
  const [caret, setCaret] = useState(0);
  const [caretPixels, setCaretPixels] = useState<{
    top: number;
    left: number;
    lineHeight: number;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const measureCaret = useCaretPosition();

  const { clients, categories: mainCategories, subCategories, enhancements } =
    useClientsConfig();

  const tagItems = useMemo<AutocompleteItem[]>(() => {
    const items: AutocompleteItem[] = [];
    for (const main of mainCategories)
      items.push({ value: main, label: main, sublabel: "main" });
    for (const sub of subCategories)
      items.push({ value: sub.name, label: sub.name, sublabel: sub.parentMainCategory });
    items.sort((a, b) => a.label.localeCompare(b.label));
    return items;
  }, [mainCategories, subCategories]);

  const clientItems = useMemo<AutocompleteItem[]>(
    () => [...clients].sort((a, b) => a.localeCompare(b)).map((c) => ({ value: c, label: c })),
    [clients],
  );

  // `!` suggestions come straight off the Enhancement roster, so the only
  // values a user can insert are ones Finance will recognise.
  const enhancementItems = useMemo<AutocompleteItem[]>(
    () =>
      [...enhancements]
        .sort((a, b) => a.localeCompare(b))
        .map((e) => ({ value: e, label: e, sublabel: "enhancement" })),
    [enhancements],
  );

  // Dirty-guarded initialText sync — only overwrites when the user hasn't edited.
  const lastPushedInitialText = useRef(initialText);
  useEffect(() => {
    if (initialText === undefined) return;
    if (initialText === lastPushedInitialText.current) return;
    setText((current) => {
      const prev = lastPushedInitialText.current;
      lastPushedInitialText.current = initialText;
      return current === prev ? initialText : current;
    });
  }, [initialText]);

  // ── Tag autocomplete ────────────────────────────────────────────────────────

  const handleReplace = useCallback((nextValue: string, nextCaret: number) => {
    setText(nextValue);
    setCaret(nextCaret);
    queueMicrotask(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextCaret, nextCaret);
    });
  }, []);

  const autocomplete = useTagAutocomplete({
    tagItems,
    clientItems,
    enhancementItems,
    value: text,
    caret,
    onReplace: handleReplace,
  });

  useEffect(() => {
    if (!autocomplete.active || !textareaRef.current) {
      setCaretPixels(null);
      return;
    }
    setCaretPixels(measureCaret(textareaRef.current, autocomplete.active.start));
  }, [autocomplete.active, measureCaret]);

  const syncCaret = useCallback(() => {
    setCaret(textareaRef.current?.selectionEnd ?? 0);
  }, []);

  // ── Backdrop highlight ──────────────────────────────────────────────────────

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const bd = backdropRef.current;
    if (!ta || !bd) return;
    bd.scrollTop = ta.scrollTop;
  }, []);

  const highlightRegex = useMemo(
    () =>
      buildHighlightRegex(
        tagItems.filter((i) => /[^A-Za-z0-9]/.test(i.value)).map((i) => i.value),
        enhancements,
      ),
    [tagItems, enhancements],
  );

  const taggedContent = useMemo(
    () => renderTagged(text, highlightRegex),
    [text, highlightRegex],
  );

  // ── Event handlers ──────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    if (!text.trim() || isProcessing) return;
    // State retention (Epic 1): do NOT clear the textarea on submit. The
    // text persists — whether the parse succeeded, produced cards, or
    // errored out on a bad format — until the user clears it themselves.
    onSubmit(text.trim());
  }, [text, isProcessing, onSubmit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setCaret(e.target.selectionEnd ?? e.target.value.length);
    onEdit?.();
  }, [onEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autocomplete.handleKeyDown(e)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autocomplete, handleSubmit],
  );

  // ── Formatting guide popover ────────────────────────────────────────────────

  const formatGuide = (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 text-left">
        <p className="font-semibold text-sm text-foreground">Formatting Guide</p>
        <p className="text-xs text-muted-foreground mt-1">
          The system understands natural text layouts. For the fastest mapping,
          use this structured format:
        </p>
        <pre className="mt-3 rounded-md bg-muted/60 border border-border/40 p-3 text-xs text-foreground font-mono leading-relaxed whitespace-pre">
{`Task 1 - xx%
Task 2 - xx%

Task Title/Header :
-- task 1
-- task 2 - xx%`}
        </pre>
        <p className="text-[11px] text-muted-foreground mt-3">
          <span className="font-medium">Note:</span> Percentages with decimals
          (e.g., 16.67%) and grouped task lists are natively supported.
        </p>
        <p className="font-semibold text-sm text-foreground mt-4">Use tagging shortcuts</p>
        <p className="text-xs text-muted-foreground mt-1">
          To ensure the system understands your log clearly, use tagging shortcuts when specifying a client, category or enhancement:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-foreground">
          <li className="flex items-center gap-2">
            <mark className="bg-green-200/60 dark:bg-green-900/50 dark:text-green-300 rounded-[3px] px-1 not-italic font-mono">@ClientName</mark>
            <span className="text-muted-foreground">— tag a client</span>
          </li>
          <li className="flex items-center gap-2">
            <mark className="bg-orange-200/60 dark:bg-orange-900/50 dark:text-orange-300 rounded-[3px] px-1 not-italic font-mono">#CategoryName</mark>
            <span className="text-muted-foreground">— tag a work category</span>
          </li>
          <li className="flex items-center gap-2">
            <mark className="bg-amber-200/70 dark:bg-amber-900/50 dark:text-amber-300 rounded-[3px] px-1 not-italic font-mono">
              {ENHANCEMENT_SIGIL}EnhancementName
            </mark>
            <span className="text-muted-foreground">— tag a specific enhancement</span>
          </li>
        </ul>
        <p className="text-xs text-muted-foreground mt-2">
          Enhancement tags only apply to <span className="text-foreground">Specific Enhancement</span> work, and
          only names on the Admin roster are recognised. Finance reads this as its own column, so tagging here
          saves picking it on the card later.
        </p>
      </PopoverContent>
    </Popover>
  );

  if (minimized) return null;

  return (
    <div className="flex-1 flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-6">
        {/* Background glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden -z-10">
          <div className="w-[500px] h-[500px] rounded-full bg-gradient-to-br from-[hsl(242,73%,16%,0.06)] via-[hsl(260,80%,60%,0.08)] to-[hsl(200,90%,60%,0.06)] blur-3xl" />
        </div>

        {headerSlot && <div className="w-full">{headerSlot}</div>}

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">
              Enter Work Allocation Manually
            </h2>
            {formatGuide}
          </div>
        </div>

        {/* Textarea + highlight backdrop */}
        <div className="w-full relative rounded-2xl border border-border/60 bg-muted/30 shadow-lg shadow-primary/5 transition-all">
          {/*
            Highlight backdrop — sits absolutely behind the transparent textarea.
            Must share identical typography + padding so characters line up exactly.
          */}
          <div
            ref={backdropRef}
            aria-hidden="true"
            className="absolute inset-0 p-5 pr-16 text-sm leading-relaxed pointer-events-none select-none overflow-hidden rounded-2xl text-foreground"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "break-word" }}
          >
            {taggedContent}
          </div>

          <Textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={syncCaret}
            onClick={syncCaret}
            onScroll={syncScroll}
            placeholder="Paste or enter your work summary here..."
            className="relative min-h-[180px] resize-none border-0 bg-transparent p-5 pr-16 text-sm leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
            style={{ color: "transparent", caretColor: "hsl(var(--foreground))" }}
            disabled={isProcessing}
          />

          {isProcessing && (
            <div className="absolute left-5 bottom-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Parsing with Claude…</span>
            </div>
          )}

          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || isProcessing}
              className={cn(
                "p-2.5 rounded-xl transition-all duration-200",
                text.trim()
                  ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg hover:scale-105"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground/60">
          Press{" "}
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-muted text-[10px] font-mono">Enter</kbd>{" "}
          to submit ·{" "}
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-muted text-[10px] font-mono">Shift+Enter</kbd>{" "}
          for new line
        </p>
      </div>

      {/* Tag / client suggestion popover */}
      {autocomplete.active && caretPixels && autocomplete.suggestions.length > 0 && (
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
  );
};

export default AIPromptBox;
