import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface FormErrorProps {
  /** The error message to show. When null/undefined/empty, nothing renders. */
  message?: string | null;
  className?: string;
}

/**
 * Unified form-level error banner for the auth screens (Login, OTP,
 * Change Password). Renders a bordered, soft-red shadcn <Alert> with an
 * AlertCircle icon — the same pattern enterprise apps (GitHub, Vercel)
 * use for login failures — instead of raw red text floating above inputs.
 *
 * Place it at the top of a form, below the header and above the first
 * input. Returns null when there's no message so callers can render it
 * unconditionally without an extra `{error && ...}` guard.
 */
const FormError = ({ message, className }: FormErrorProps) => {
  if (!message) return null;
  return (
    <Alert
      variant="destructive"
      className={cn(
        "border-destructive/40 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="text-sm font-medium text-destructive">
        {message}
      </AlertDescription>
    </Alert>
  );
};

export default FormError;
