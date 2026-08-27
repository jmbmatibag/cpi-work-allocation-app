import { useState, useCallback, useMemo, useEffect } from "react";
import { ENHANCEMENT_SIGIL } from "@/lib/tagHighlight";

/**
 * Autocomplete state + behavior for a textarea where `#tag` and
 * `@client` tokens should trigger a suggestions popover.
 *
 * Logic split from UI — this hook reads textarea content + caret,
 * decides whether a popover is warranted, filters the suggestion
 * list, handles arrow-key navigation, and exposes `acceptSuggestion`
 * to replace the active token with the picked value.
 *
 * It does NOT manage DOM positioning (see useCaretPosition) or
 * render anything (see TagSuggestPopover).
 */

/** Sigils that can open a suggestion popover. */
export type TagTrigger = "#" | "@" | typeof ENHANCEMENT_SIGIL;

export interface AutocompleteItem {
  /** Text inserted into the textarea, without the trigger char. */
  value: string;
  /** Primary label shown in the popover row. */
  label: string;
  /** Optional secondary text (e.g. "Projects" for sub category Geniisys). */
  sublabel?: string;
}

export interface UseTagAutocompleteArgs {
  /** Items to suggest when # is typed. Deduplicated + sorted upstream. */
  tagItems: readonly AutocompleteItem[];
  /** Items to suggest when @ is typed. */
  clientItems: readonly AutocompleteItem[];
  /**
   * Items to suggest when the enhancement sigil is typed. Optional: surfaces
   * that have no enhancement concept simply omit it and the trigger stays
   * inert rather than opening an empty popover.
   */
  enhancementItems?: readonly AutocompleteItem[];
  /** The current textarea value. */
  value: string;
  /** Current caret position (end of selection). */
  caret: number;
  /** Called with the new value + new caret position after accept. */
  onReplace: (nextValue: string, nextCaret: number) => void;
}

export interface ActiveToken {
  /** Which popover is open. */
  trigger: TagTrigger;
  /** Character index where the trigger char sits. */
  start: number;
  /** Character index where the active token ends (i.e. `caret`). */
  end: number;
  /** Filter text — everything between the trigger and the caret. */
  query: string;
}

export interface UseTagAutocompleteReturn {
  /** Open state: null when no tag is being typed at the caret. */
  active: ActiveToken | null;
  /** Current filtered suggestion list. */
  suggestions: AutocompleteItem[];
  /** Currently highlighted suggestion index (0-based). */
  activeIndex: number;
  /** Mouse hover updates the highlight — bypasses keyboard nav. */
  setActiveIndex: (index: number) => void;
  /**
   * Call from textarea onKeyDown. Returns `true` if the key was
   * consumed by the autocomplete (caller should skip its own handler).
   */
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Accept a specific suggestion by index (e.g. on mouse click). */
  acceptSuggestion: (index: number) => void;
  /** Close the popover without inserting anything. */
  dismiss: () => void;
}

export function useTagAutocomplete({
  tagItems,
  clientItems,
  enhancementItems,
  value,
  caret,
  onReplace,
}: UseTagAutocompleteArgs): UseTagAutocompleteReturn {
  const [activeIndex, setActiveIndex] = useState(0);
  // When the user presses Escape we want to suppress the popover
  // until they advance past the current token. Tracked here so a
  // dismissed token doesn't reopen on the next keystroke in-place.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // Identify the active token at the caret. Walk backwards from the
  // caret until we hit a trigger char (#/@) or whitespace. If we hit
  // whitespace first, there's no active token.
  const active = useMemo<ActiveToken | null>(() => {
    if (caret < 1) return null;

    let i = caret - 1;
    while (i >= 0) {
      const ch = value[i];
      // The enhancement sigil only counts as a trigger when the surface
      // actually supplied a roster; otherwise "!" is ordinary punctuation.
      const isEnhTrigger = ch === ENHANCEMENT_SIGIL && !!enhancementItems?.length;
      if (ch === "#" || ch === "@" || isEnhTrigger) {
        // Trigger char must be at start of input or after whitespace.
        // Matches the parser's TAG_RE / @client token rules.
        const prev = i === 0 ? " " : value[i - 1];
        if (!/\s/.test(prev) && i !== 0) return null;

        // Suppressed via Escape on this exact trigger position.
        if (dismissedAt === i) return null;

        return {
          trigger: ch as TagTrigger,
          start: i,
          end: caret,
          query: value.substring(i + 1, caret),
        };
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  }, [value, caret, dismissedAt, enhancementItems]);

  // Filter suggestions. Case-insensitive prefix match on the label,
  // then case-insensitive substring match as a fallback. Prefix
  // matches feel snappier (type "ge" → "Geniisys"); substring
  // matches cover cases like "bd" → "BD/Mktg/Sales".
  const suggestions = useMemo(() => {
    if (!active) return [];
    const pool =
      active.trigger === "#"
        ? tagItems
        : active.trigger === "@"
          ? clientItems
          : (enhancementItems ?? []);
    const q = active.query.toLowerCase();
    if (!q) return pool.slice(0, 10);

    const prefix: AutocompleteItem[] = [];
    const contains: AutocompleteItem[] = [];
    for (const item of pool) {
      const lbl = item.label.toLowerCase();
      if (lbl.startsWith(q)) prefix.push(item);
      else if (lbl.includes(q)) contains.push(item);
    }
    return [...prefix, ...contains].slice(0, 10);
  }, [active, tagItems, clientItems, enhancementItems]);

  // Keep activeIndex in range as suggestions change. Use effect so
  // we don't set state during render.
  useEffect(() => {
    if (activeIndex >= suggestions.length && suggestions.length > 0) {
      setActiveIndex(0);
    }
  }, [activeIndex, suggestions.length]);

  const accept = useCallback(
    (index: number) => {
      if (!active) return;
      const picked = suggestions[index];
      if (!picked) return;

      const insertion = active.trigger + picked.value;
      const before = value.substring(0, active.start);
      // Skip any trailing space the user might have already typed,
      // but we append one ourselves to "seal" the token.
      const afterRaw = value.substring(active.end);
      const needsSpace = !/^\s/.test(afterRaw);
      const after = needsSpace ? " " + afterRaw : afterRaw;

      const nextValue = before + insertion + after;
      const nextCaret = before.length + insertion.length + 1; // past the space
      onReplace(nextValue, nextCaret);

      // Reset state.
      setActiveIndex(0);
      setDismissedAt(null);
    },
    [active, suggestions, value, onReplace],
  );

  const handleKeyDown = useCallback<
    UseTagAutocompleteReturn["handleKeyDown"]
  >(
    (e) => {
      if (!active || suggestions.length === 0) return false;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev >= suggestions.length - 1 ? 0 : prev + 1,
          );
          return true;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev <= 0 ? suggestions.length - 1 : prev - 1,
          );
          return true;
        case "Tab":
        case "Enter":
          e.preventDefault();
          accept(activeIndex);
          return true;
        case "Escape":
          e.preventDefault();
          // Remember which trigger position was dismissed so the
          // popover doesn't reopen on the same token.
          setDismissedAt(active.start);
          return true;
        default:
          return false;
      }
    },
    [active, suggestions, activeIndex, accept],
  );

  const dismiss = useCallback(() => {
    if (active) setDismissedAt(active.start);
  }, [active]);

  return {
    active,
    suggestions,
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    acceptSuggestion: accept,
    dismiss,
  };
}
