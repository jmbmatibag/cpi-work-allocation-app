import { useState } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";

interface WorkPeriodPickerProps {
  month: string;
  year: string;
  onMonthChange: (m: string) => void;
  onYearChange: (y: string) => void;
}

const monthsFull = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthsShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const WorkPeriodPicker = ({ month, year, onMonthChange, onYearChange }: WorkPeriodPickerProps) => {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [viewYear, setViewYear] = useState(year ? parseInt(year) : now.getFullYear());

  const displayValue = month && year ? `${month} ${year}` : undefined;
  const selectedMonthIdx = month ? monthsFull.indexOf(month) : -1;
  const selectedYear = year ? parseInt(year) : -1;

  const handleMonthClick = (idx: number) => {
    onMonthChange(monthsFull[idx]);
    onYearChange(String(viewYear));
    setOpen(false);
  };

  const handleThisMonth = () => {
    onMonthChange(monthsFull[now.getMonth()]);
    onYearChange(String(now.getFullYear()));
    setOpen(false);
  };

  const handleClear = () => {
    onMonthChange("");
    onYearChange("");
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Work Period</Label>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setViewYear(year ? parseInt(year) : now.getFullYear()); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !displayValue && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {displayValue || "Select period..."}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0" align="start">
          {/* Year nav */}
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewYear(v => v - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold">{viewYear}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewYear(v => v + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {/* Month grid */}
          <div className="grid grid-cols-4 gap-1 p-3">
            {monthsShort.map((m, idx) => {
              const isSelected = selectedMonthIdx === idx && selectedYear === viewYear;
              return (
                <Button
                  key={m}
                  variant={isSelected ? "default" : "ghost"}
                  size="sm"
                  className={cn("h-9 text-sm", isSelected && "bg-primary text-primary-foreground")}
                  onClick={() => handleMonthClick(idx)}
                >
                  {m}
                </Button>
              );
            })}
          </div>
          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-2 border-t">
            <Button variant="ghost" size="sm" className="text-muted-foreground text-xs" onClick={handleClear}>
              Clear
            </Button>
            <Button variant="ghost" size="sm" className="text-primary font-semibold text-xs" onClick={handleThisMonth}>
              This month
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default WorkPeriodPicker;
