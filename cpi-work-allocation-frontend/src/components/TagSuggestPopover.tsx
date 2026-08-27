import { useEffect, useRef } from "react";
import { Hash, AtSign, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutocompleteItem, TagTrigger } from "@/hooks/useTagAutocomplete";

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
  trigger: TagTrigger;
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

  const Icon = trigger === "#" ? Hash : trigger === "@" ? AtSign : Sparkles;
  const triggerLabel =
    trigger === "#" ? "Tag" : trigger === "@" ? "Client" : "Enhancement";

  return (
    <div
      role="listbox"
      aria-label={`${triggerLabel} suggestions`}
      className="fixed z-50 rounded-lg shadow-lg overflow-hidden border border-border bg-popover text-popover-foreground"
      style={{
        // Render just below the caret, offset by line-height so we
        // don't overlap the text the user is typing.
        top: top + lineHeight + 4,
        left,
        minWidth: 220,
        maxWidth: 320,
        maxHeight: 280,
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider font-semibold bg-muted text-muted-foreground border-b border-border">
        <Icon className="h-3 w-3" />
        <span>{triggerLabel}s</span>
        <span className="ml-auto text-[10px] font-normal tabular-nums text-muted-foreground/70">
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
              className={cn(
                "flex items-baseline justify-between gap-2 px-2.5 py-1.5 cursor-pointer transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-popover-foreground hover:bg-muted",
              )}
            >
              <span className="text-[13px] font-medium truncate">
                {item.label}
              </span>
              {item.sublabel && (
                <span
                  className={cn(
                    "text-[11px] truncate shrink-0",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
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
