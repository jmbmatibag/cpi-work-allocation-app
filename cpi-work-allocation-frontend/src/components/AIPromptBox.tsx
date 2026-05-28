import { useState, useRef, useEffect } from "react";
import { ArrowUp, Loader2, Sparkles, Info } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface AIPromptBoxProps {
  onSubmit: (text: string) => void;
  isProcessing: boolean;
  minimized: boolean;
  initialText?: string;
}

const AIPromptBox = ({ onSubmit, isProcessing, minimized, initialText }: AIPromptBoxProps) => {
  const [text, setText] = useState(initialText ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Dirty-guarded sync from initialText.
   *
   * The parent may push a new initialText at any time (e.g., the user
   * clicks Auto-Generate a second time after adding a journal entry).
   * We only overwrite local state if the user hasn't edited — if the
   * current local text matches the previous initialText we pushed, they
   * haven't typed; otherwise they have unsaved edits and we preserve
   * them. The ref holds the last-pushed value so we can tell the two
   * cases apart without putting `text` in the effect's deps (that
   * would re-fire on every keystroke).
   *
   * This closes the clobber bug identified in the Phase 6 audit.
   */
  const lastPushedInitialText = useRef(initialText);
  useEffect(() => {
    if (initialText === undefined) return;
    if (initialText === lastPushedInitialText.current) return;

    setText((current) => {
      const prev = lastPushedInitialText.current;
      lastPushedInitialText.current = initialText;
      return current === prev ? initialText : current;
    });
  }, [initialText]);

  const handleSubmit = () => {
    if (!text.trim() || isProcessing) return;
    onSubmit(text.trim());
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const formatGuide = (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 text-left">
        <p className="font-semibold text-sm text-foreground">Formatting Guide</p>
        <p className="text-xs text-muted-foreground mt-1">
          The AI can understand natural language, but for best results, use this format:
        </p>
        <pre className="mt-3 rounded-md bg-muted/60 border border-border/40 p-3 text-xs text-foreground font-mono leading-relaxed whitespace-pre">
{`Client Name:
-- task 1
-- task 2 - 20%`}
        </pre>
        <p className="text-[11px] text-muted-foreground mt-3">
          <span className="font-medium">Note:</span> Decimals (like 16.67%) and grouped tasks are fully supported.
        </p>
      </PopoverContent>
    </Popover>
  );

  if (minimized) {
    return null;
  }

  return (
    <div className="flex-1 flex items-center justify-center animate-fade-in">
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-6">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden -z-10">
          <div className="w-[500px] h-[500px] rounded-full bg-gradient-to-br from-[hsl(242,73%,16%,0.06)] via-[hsl(260,80%,60%,0.08)] to-[hsl(200,90%,60%,0.06)] blur-3xl" />
        </div>

        <div className="text-center space-y-2">
          {/*<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/5 border border-primary/10 text-primary text-xs font-medium mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            AI-Powered Entry
          </div>*/}
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Enter Work Allocation</h2>
            {formatGuide}
          </div>
          <p className="text-sm text-muted-foreground max-w-md">
            Paste your work summary below and it will automatically categorize and allocate your tasks.
          </p>
        </div>

        <div className="w-full relative rounded-2xl border border-border/60 bg-muted/30 shadow-lg shadow-primary/5 transition-all">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste your work summary here..."
            className="min-h-[180px] resize-none border-0 bg-transparent p-5 pr-16 text-sm leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
            disabled={isProcessing}
          />
          {isProcessing && (
            <div className="absolute left-5 bottom-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Parsing with Claude…</span>
            </div>
          )}
          <div className="absolute right-3 bottom-3 flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || isProcessing}
              className={cn(
                "p-2.5 rounded-xl transition-all duration-200",
                text.trim()
                  ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg hover:scale-105"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground/60">
          Press <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-muted text-[10px] font-mono">Enter</kbd> to submit · <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-muted text-[10px] font-mono">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
};

export default AIPromptBox;
