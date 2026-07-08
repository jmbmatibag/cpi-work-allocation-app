/**
 * Shared backdrop-highlight utilities for textarea tag colouring.
 *
 * Used by AIPromptBox (Monthly Allocations) and SmartJournalLine (Daily Log).
 *
 * Technique: a mirror <div> sits absolutely behind the transparent textarea.
 * It renders the same text with @client tokens in sky-blue and #category tokens
 * in violet. The textarea itself uses color:transparent so the coloured marks
 * show through, while caret-color keeps the cursor visible.
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Separator class used between the words of a multi-word tag name: the
 * taxonomy's own punctuation (comma, ampersand, slash, en/em dash, hyphen)
 * plus arbitrary surrounding whitespace. Keeps this consistent with the
 * prompt parser's preprocessMultiWordTags so highlighting, detection, and
 * parsing all recognise the same variants.
 */
const TAG_SEPARATOR = "[\\s,&/–—-]+";

/**
 * Build a whitespace-/punctuation-tolerant regex fragment matching a
 * multi-word taxonomy name after a "#". Splits the name into its alphanumeric
 * word runs, then rejoins them with TAG_SEPARATOR so a user can type any of:
 *   #Sales, Marketing & BD      (canonical)
 *   #Sales,Marketing & BD       (missing space)
 *   #Sales , Marketing  &  BD   (extra padding)
 * and all match as one token. Returns null when the name has no
 * alphanumeric content.
 */
export function multiWordTagPattern(name: string): string | null {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(TAG_SEPARATOR);
}

/**
 * Single-token fallback for a `#tag` body: a letter followed by word-ish
 * chars, slashes and hyphens. Used when no known multi-word name matches —
 * this preserves the original single-word extraction behaviour.
 */
const SINGLE_WORD_TAG_BODY = "[A-Za-z][A-Za-z0-9_/-]*";

/**
 * Build the regex *body* (the part after the `#`) that matches a category
 * tag, widened to capture known multi-word taxonomy names — e.g.
 * "TRAINING & DEVELOPMENT", "Sales, Marketing & BD", "Quick Policy" — as a
 * SINGLE token rather than stopping at the first space, comma or ampersand.
 *
 * Each name carrying a separator becomes a separator-tolerant alternate
 * (longest-first so the most specific name wins); a plain single-word
 * fallback closes the alternation so unknown/short tags still extract exactly
 * as before. Single-word names are ignored — the fallback already covers them.
 *
 * This is the shared, structured-data-driven core the whole app leans on: the
 * live editing highlighter (buildHighlightRegex) and the journal aggregator
 * both consume it, so the SAME tag boundaries are recognised everywhere. Pass
 * the full taxonomy name list; when it's empty the body degrades to the
 * single-word form.
 */
export function categoryTagBody(names: readonly string[]): string {
  // Longest first so "Quick Policy Plus" wins over "Quick Policy", and
  // "Sales, Marketing & BD" is tried before a bare "Sales".
  const alternates = [...names]
    .filter((n) => /[^A-Za-z0-9]/.test(n))
    .sort((a, b) => b.length - a.length)
    .map(multiWordTagPattern)
    .filter((p): p is string => p !== null);
  return alternates.length > 0
    ? `(?:${alternates.join("|")}|${SINGLE_WORD_TAG_BODY})`
    : SINGLE_WORD_TAG_BODY;
}

/**
 * Build a highlight regex that includes known multi-word taxonomy names as
 * explicit alternates so "#Quick Policy" or "#Sales, Marketing & BD" is
 * highlighted as a single token rather than stopping at the first space or
 * comma. Alternates are matched tolerantly (see multiWordTagPattern).
 *
 * @param multiWordNames  Names carrying a separator (e.g. ["Quick Policy",
 *                        "Sales, Marketing & BD"]). Pass an empty array when
 *                        unknown.
 */
export function buildHighlightRegex(multiWordNames: readonly string[]): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9])(@[A-Za-z][A-Za-z0-9_-]*|#${categoryTagBody(multiWordNames)})`,
    "g",
  );
}

/**
 * Split raw textarea text into plain-text and highlighted-tag segments.
 *
 * @param text  The current textarea value.
 * @param re    Regex built by buildHighlightRegex — must have the `g` flag.
 *              Pass the same RegExp instance across renders; lastIndex is
 *              reset inside this function before each traversal.
 */
export function renderTagged(text: string, re: RegExp): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;

  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<span key={k++}>{text.slice(last, m.index)}</span>);
    }
    const isAt = m[1][0] === "@";
    // box-shadow spreads the background 3px left/right without adding to the
    // element's layout width — keeping backdrop characters pixel-aligned with
    // the textarea so the caret stays in the correct visual position.
    const shadow = isAt
      ? "3px 0 0 rgb(187 247 208 / 0.6), -3px 0 0 rgb(187 247 208 / 0.6)"
      : "3px 0 0 rgb(254 215 170 / 0.6), -3px 0 0 rgb(254 215 170 / 0.6)";
    nodes.push(
      <mark
        key={k++}
        className={cn(
          "rounded-[3px] not-italic",
          isAt ? "bg-green-200/60" : "bg-orange-200/60",
        )}
        style={{ boxShadow: shadow }}
      >
        {m[1]}
      </mark>,
    );
    last = m.index + m[1].length;
  }

  if (last < text.length) nodes.push(<span key={k++}>{text.slice(last)}</span>);
  // Sentinel prevents last-line height collapse when text ends with "\n"
  nodes.push(<span key={k}>{" "}</span>);

  return <>{nodes}</>;
}
