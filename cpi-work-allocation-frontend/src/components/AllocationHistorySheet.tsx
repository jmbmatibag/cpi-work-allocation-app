import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/apiClient";
import AllocationTimeline from "@/components/AllocationTimeline";

// Peer coverage / history are persisted server-side; in localStorage/demo mode
// there is no audit trail to fetch, so the query stays disabled and the panel
// degrades to its empty state.
const isApiMode = import.meta.env.VITE_USE_API === "true";

// ---------------------------------------------------------------------------
// AllocationHistorySheet — a right-hand side panel (shadcn <Sheet>) that slides
// in an allocation's lifecycle timeline. Wraps a minimalist ghost trigger
// button ("History") and owns the data fetch, which is deferred until the
// panel is actually opened.
// ---------------------------------------------------------------------------

interface AllocationHistorySheetProps {
  allocationId: string;
  // Sub-line under the title, e.g. "Andrea Cruz · June 2026".
  subtitle?: string;
  // Override the default ghost trigger button (e.g. an icon-only variant).
  trigger?: ReactNode;
  // Label for the default trigger button.
  label?: string;
}

const AllocationHistorySheet = ({
  allocationId,
  subtitle,
  trigger,
  label = "History",
}: AllocationHistorySheetProps) => {
  const [open, setOpen] = useState(false);

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["allocation-history", allocationId],
    queryFn: ({ signal }) => api.allocations.history(allocationId, signal),
    // Only hit the network once the panel is opened — the history is a
    // secondary detail, not something to prefetch for every visible row.
    enabled: isApiMode && open,
    staleTime: 15_000,
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <History className="h-4 w-4" />
            {label}
          </Button>
        )}
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-1 border-b px-6 py-4 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Allocation History
          </SheetTitle>
          <SheetDescription>
            {subtitle ?? "Full lifecycle of this allocation, newest first."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scrollbar-modern px-6 py-6">
          <AllocationTimeline
            events={data}
            isLoading={isLoading}
            isError={isError}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default AllocationHistorySheet;
