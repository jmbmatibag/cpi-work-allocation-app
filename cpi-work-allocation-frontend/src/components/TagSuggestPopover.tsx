import { useEffect, useRef } from "react";
import { Hash, AtSign } from "lucide-react";
import type { AutocompleteItem } from "@/hooks/useTagAutocomplete";

/**
 * Presentational popover for tag/client autocomplete.
 *
 * Positioning is done by the parent — this component just renders
 * a floating card at the top/left coordinates provided. Parent is
 * responsible for clamping to the viewport (left edge overflow is
 * the only one that tends to matter in practice; right/bottom
 * rarely become problems at typical textarea sizes).
 *
 * Keyboard handling happens upstream in useTagAutocomplete; this
 * component handles only mouse interactions (hover to highlight,
 * click to accept).
 */

export interface TagSuggestPopoverProps {
  items: readonly AutocompleteItem[];
  activeIndex: number;
  trigger: "#" | "@";
  /** Caret-top coordinate in the textarea's coordinate system. */
  top: number;
  /** Caret-left coordinate in the textarea's coordinate system. */
  left: number;
  /** Line height of the textarea so we render just below the caret. */
  lineHeight: number;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

export const TagSuggestPopover = ({
  items,
  activeIndex,
  trigger,
  top,
  left,
  lineHeight,
  onHover,
  onSelect,
}: TagSuggestPopoverProps) => {
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-scroll active item into view when activeIndex changes via
  // arrow keys — otherwise users can navigate past the visible
  // window without seeing the highlight move.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.children[activeIndex] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (items.length === 0) return null;

  const Icon = trigger === "#" ? Hash : AtSign;
  const triggerLabel = trigger === "#" ? "Tag" : "Client";

  return (
    <div
      role="listbox"
      aria-label={`${triggerLabel} suggestions`}
      className="fixed z-50 rounded-lg shadow-lg overflow-hidden"
      style={{
        // Render just below the caret, offset by line-height so we
        // don't overlap the text the user is typing.
        top: top + lineHeight + 4,
        left,
        background: "hsl(0 0% 100%)",
        border: "1px solid hsl(220 13% 88%)",
        minWidth: 220,
        maxWidth: 320,
        maxHeight: 280,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-semibold"
        style={{
          background: "hsl(220 14% 97%)",
          color: "hsl(220 10% 50%)",
          borderBottom: "1px solid hsl(220 13% 92%)",
        }}
      >
        <Icon className="h-3 w-3" />
        <span>{triggerLabel}s</span>
        <span
          className="ml-auto text-[10px] font-normal tabular-nums"
          style={{ color: "hsl(220 8% 60%)" }}
        >
          ↑↓ navigate · ⇥ accept
        </span>
      </div>
      <ul
        ref={listRef}
        className="overflow-y-auto py-1"
        style={{ maxHeight: 240 }}
      >
        {items.map((item, idx) => {
          const active = idx === activeIndex;
          return (
            <li
              key={`${item.value}-${idx}`}
              role="option"
              aria-selected={active}
              onMouseEnter={() => onHover(idx)}
              onMouseDown={(e) => {
                // mousedown rather than click so we fire before the
                // textarea loses focus; prevents blur-close races.
                e.preventDefault();
                onSelect(idx);
              }}
              className="flex items-baseline justify-between gap-2 px-2.5 py-1.5 cursor-pointer transition-colors"
              style={{
                background: active ? "hsl(224 72% 95%)" : "transparent",
                color: active ? "hsl(224 72% 25%)" : "hsl(222 20% 15%)",
              }}
            >
              <span className="text-[13px] font-medium truncate">
                {item.label}
              </span>
              {item.sublabel && (
                <span
                  className="text-[11px] truncate shrink-0"
                  style={{
                    color: active ? "hsl(224 50% 45%)" : "hsl(220 10% 55%)",
                  }}
                >
                  {item.sublabel}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
