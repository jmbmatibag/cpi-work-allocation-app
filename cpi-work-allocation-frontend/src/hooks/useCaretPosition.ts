import { useCallback } from "react";

/**
 * Returns the pixel coordinates of a textarea's caret in document
 * space, suitable for positioning a popover next to the cursor.
 *
 * Technique: create a hidden `<div>` styled identically to the
 * textarea, copy the text up to the caret into it, put a sentinel
 * <span> at the end, measure the sentinel's bounding rect. The
 * sentinel's top/left are the caret's top/left (in the mirror),
 * which we translate back to the textarea's coordinate system by
 * adding the textarea's bounding rect.
 *
 * Textareas don't expose caret pixels natively — this is the
 * standard workaround. The mirror div is appended and removed on
 * each call; building it once per call costs ~1ms which is fine
 * for key-level interactions.
 *
 * CSS properties that affect text layout must be copied exactly
 * from the textarea onto the mirror for positions to match. Font,
 * padding, border, box-sizing, word-break all matter.
 */

// Properties to copy from the textarea to the mirror div.
// Covered: typography, spacing, sizing, text wrapping. Anything that
// changes how characters flow in the textarea.
const MIRROR_STYLE_PROPERTIES: Array<keyof CSSStyleDeclaration> = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordBreak",
  "overflowWrap",
];

export function useCaretPosition() {
  /**
   * Measure caret pixel position for `textarea` when the caret is
   * at character index `caretIndex`. Returns document-space
   * coordinates (to be used with `position: fixed` or adjusted
   * against a reference element's getBoundingClientRect).
   */
  const measure = useCallback(
    (
      textarea: HTMLTextAreaElement,
      caretIndex: number,
    ): { top: number; left: number; lineHeight: number } => {
      const computed = window.getComputedStyle(textarea);

      const mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");

      // Position off-screen but not display:none — we need layout.
      mirror.style.position = "absolute";
      mirror.style.top = "0";
      mirror.style.left = "-9999px";
      mirror.style.visibility = "hidden";
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.wordWrap = "break-word";

      for (const prop of MIRROR_STYLE_PROPERTIES) {
        mirror.style[prop as string] = computed[prop] as string;
      }

      // Textarea overflow is auto but mirror shouldn't scroll — we
      // want it to grow with the content. Override after copy.
      mirror.style.overflow = "hidden";

      // Text up to caret, then a zero-width sentinel we measure.
      const before = textarea.value.substring(0, caretIndex);
      mirror.textContent = before;

      const sentinel = document.createElement("span");
      // Use a zero-width non-breaking space so the browser allocates
      // a real layout box even at end of line.
      sentinel.textContent = "\u200b";
      mirror.appendChild(sentinel);

      document.body.appendChild(mirror);

      const sentinelRect = sentinel.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();
      const textareaRect = textarea.getBoundingClientRect();

      // Offset inside the mirror (same offset inside the textarea,
      // modulo scroll).
      const offsetTop = sentinelRect.top - mirrorRect.top;
      const offsetLeft = sentinelRect.left - mirrorRect.left;

      // Translate to document space, accounting for textarea scroll.
      const top = textareaRect.top + offsetTop - textarea.scrollTop;
      const left = textareaRect.left + offsetLeft - textarea.scrollLeft;

      const lineHeight = parseFloat(computed.lineHeight) || 20;

      document.body.removeChild(mirror);

      return { top, left, lineHeight };
    },
    [],
  );

  return measure;
}
