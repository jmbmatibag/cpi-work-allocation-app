import { useState, useEffect } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type SortingState,
  type PaginationState,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/TablePagination";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type { ColumnDef };

interface DataTableProps<TData, TValue = unknown> {
  columns: ColumnDef<TData, TValue>[];
  /** Pre-filtered data. DataTable owns sort, selection, and pagination only. */
  data: TData[];
  /** Rows per page. Default: 10. */
  pageSize?: number;
  /** Message shown when data is empty. */
  emptyMessage?: string;
  /** Initial sort state. */
  defaultSorting?: SortingState;
  /** Enable row checkboxes. Requires getRowId. */
  selectable?: boolean;
  /**
   * Stable row identity function. Required when selectable=true so
   * selection survives re-sorts and page changes.
   */
  getRowId?: (row: TData) => string;
  /**
   * Called whenever the selection changes. Receives the array of
   * currently selected original data objects.
   */
  onSelectionChange?: (selected: TData[]) => void;
  className?: string;
  /** Increment to programmatically clear row selection from outside. */
  resetKey?: number;
}

export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  pageSize = 10,
  emptyMessage = "No results.",
  defaultSorting = [],
  selectable = false,
  getRowId,
  onSelectionChange,
  className,
  resetKey,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // When the dataset changes size (filters applied by parent), snap back
  // to page 1 and clear selection to avoid stale selections.
  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    setRowSelection({});
  }, [data.length]);

  // Allow parent to imperatively reset selection by incrementing resetKey.
  useEffect(() => {
    setRowSelection({});
  }, [resetKey]);

  // Propagate selection changes to the parent.
  useEffect(() => {
    if (!onSelectionChange) return;
    const selectedIds = new Set(
      Object.entries(rowSelection)
        .filter(([, v]) => v)
        .map(([k]) => k),
    );
    const selected = getRowId
      ? data.filter((row) => selectedIds.has(getRowId(row)))
      : [];
    onSelectionChange(selected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  // Prepend the checkbox column when selectable is enabled.
  const allColumns: ColumnDef<TData, TValue>[] = selectable
    ? [
        {
          id: "__select__",
          header: ({ table }) => (
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected()
                  ? true
                  : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
              }
              onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
              aria-label="Select all on this page"
              className="translate-y-[1px]"
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              checked={row.getIsSelected()}
              disabled={!row.getCanSelect()}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              aria-label="Select row"
              className="translate-y-[1px]"
            />
          ),
          enableSorting: false,
          size: 40,
        } as ColumnDef<TData, TValue>,
        ...columns,
      ]
    : columns;

  const table = useReactTable({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(next);
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    state: { sorting, pagination, rowSelection },
  });

  return (
    <div className={cn("space-y-0", className)}>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      style={
                        header.column.columnDef.size !== undefined
                          ? { width: header.column.columnDef.size }
                          : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          className="flex items-center gap-1 hover:text-foreground transition-colors -ml-0.5 px-0.5 rounded"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5 text-primary shrink-0" />
                          ) : sorted === "desc" ? (
                            <ChevronDown className="h-3.5 w-3.5 text-primary shrink-0" />
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 opacity-30 shrink-0" />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className="hover:bg-muted/40 data-[state=selected]:bg-primary/5"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={allColumns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={pagination.pageIndex + 1}
        pageSize={pageSize}
        totalItems={data.length}
        onPageChange={(p) =>
          setPagination((prev) => ({ ...prev, pageIndex: p - 1 }))
        }
      />
    </div>
  );
}
