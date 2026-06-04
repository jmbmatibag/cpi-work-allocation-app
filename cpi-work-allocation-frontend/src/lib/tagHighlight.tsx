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
 * Build a highlight regex that includes known multi-word taxonomy names as
 * explicit alternates so "#Quick Policy" is highlighted as a single token
 * rather than stopping at the space.
 *
 * @param multiWordNames  Names that contain spaces (e.g. ["Quick Policy",
 *                        "General Work"]).  Pass an empty array when unknown.
 */
export function buildHighlightRegex(multiWordNames: readonly string[]): RegExp {
  const sorted = [...multiWordNames].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tagBody =
    escaped.length > 0
      ? `(?:${escaped.join("|")}|[A-Za-z][A-Za-z0-9_/-]*)`
      : "[A-Za-z][A-Za-z0-9_/-]*";

  return new RegExp(
    `(?<![A-Za-z0-9])(@[A-Za-z][A-Za-z0-9_-]*|#${tagBody})`,
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
