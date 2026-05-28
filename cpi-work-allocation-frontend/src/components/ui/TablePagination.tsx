import type { MouseEvent } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

interface TablePaginationProps {
  /** 1-indexed current page. Out-of-range values are clamped. */
  page: number;
  /** Items per page. */
  pageSize: number;
  /** Total filtered/sorted item count (NOT the page slice length). */
  totalItems: number;
  /** Callback when the user clicks a page, Previous, or Next. */
  onPageChange: (page: number) => void;
}

type PageEntry = number | "ellipsis-left" | "ellipsis-right";

/**
 * Compact pagination control built on top of the shared shadcn
 * Pagination primitives. Pairs a "Showing X–Y of Z" counter with a
 * Prev / page-numbers / Next strip.
 *
 * Renders nothing when there are zero items so empty states show
 * their own message without a stray pager underneath.
 *
 * The component clamps `page` internally — callers can pass a stale
 * page index (e.g. after the underlying list shrinks) without
 * worrying about it; the buttons disable correctly.
 */
export const TablePagination = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
}: TablePaginationProps) => {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);

  const prevDisabled = safePage <= 1;
  const nextDisabled = safePage >= totalPages;

  const pageList = getPageList(safePage, totalPages);

  // The shadcn primitives use anchor tags. We keep them anchors for
  // a11y semantics but intercept clicks to drive state instead of
  // navigating, and fully short-circuit when disabled so a click on
  // a greyed-out Prev/Next does nothing.
  const handleClick =
    (target: number, disabled = false) =>
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (disabled) return;
      onPageChange(target);
    };

  return (
    <div className="flex items-center justify-between gap-3 pt-3 flex-wrap">
      <p className="text-sm text-muted-foreground tabular-nums">
        Showing{" "}
        <span className="text-foreground font-medium">
          {start}–{end}
        </span>{" "}
        of <span className="text-foreground font-medium">{totalItems}</span>
      </p>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={handleClick(safePage - 1, prevDisabled)}
              aria-disabled={prevDisabled}
              tabIndex={prevDisabled ? -1 : undefined}
              className={
                prevDisabled ? "pointer-events-none opacity-50" : undefined
              }
            />
          </PaginationItem>
          {pageList.map((p, i) =>
            typeof p === "string" ? (
              <PaginationItem key={`${p}-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  isActive={p === safePage}
                  onClick={handleClick(p)}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={handleClick(safePage + 1, nextDisabled)}
              aria-disabled={nextDisabled}
              tabIndex={nextDisabled ? -1 : undefined}
              className={
                nextDisabled ? "pointer-events-none opacity-50" : undefined
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
};

/**
 * Build the displayed page list with ellipsis collapsing.
 *
 * Behaviour:
 *   - <= 7 pages: show every page (no ellipsis ever).
 *   - Near the start (current <= 3): show 1..5, ellipsis, last.
 *   - Near the end (current >= total - 2): show 1, ellipsis, last-4..last.
 *   - Middle: show 1, ellipsis, current-1..current+1, ellipsis, last.
 *
 * Distinct keys for left/right ellipsis so React doesn't complain
 * when both appear in the same list.
 */
function getPageList(current: number, total: number): PageEntry[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: PageEntry[] = [1];

  let start: number;
  let end: number;

  if (current <= 3) {
    start = 2;
    end = 5;
  } else if (current >= total - 2) {
    start = total - 4;
    end = total - 1;
  } else {
    start = current - 1;
    end = current + 1;
  }

  if (start > 2) pages.push("ellipsis-left");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("ellipsis-right");

  pages.push(total);
  return pages;
}
