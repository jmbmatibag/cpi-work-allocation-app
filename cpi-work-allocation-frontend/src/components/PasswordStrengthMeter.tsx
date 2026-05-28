import { Check } from "lucide-react";

// ── Password strength rules ─────────────────────────────────────────────────
//
// Kept in lock-step with `StrongPasswordSchema` in cpi-work-allocation-shared.
// If either side changes, the other must too.

export interface PasswordRule {
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { label: "At least 8 characters",       test: (pw) => pw.length >= 8 },
  { label: "An uppercase letter (A–Z)",   test: (pw) => /[A-Z]/.test(pw) },
  { label: "A lowercase letter (a–z)",    test: (pw) => /[a-z]/.test(pw) },
  { label: "A number (0–9)",              test: (pw) => /[0-9]/.test(pw) },
  { label: "A special character (!@#…)",  test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export interface PasswordStrength {
  score: number;
  passed: boolean[];
  allValid: boolean;
}

export function evaluateStrength(pw: string): PasswordStrength {
  const passed = PASSWORD_RULES.map((r) => r.test(pw));
  const score = passed.filter(Boolean).length;
  return { score, passed, allValid: score === PASSWORD_RULES.length };
}

function strengthTier(score: number): {
  label: string;
  colorClass: string;
  widthPct: number;
} {
  if (score <= 2) return { label: "Weak",      colorClass: "bg-red-500",     widthPct: (score / PASSWORD_RULES.length) * 100 };
  if (score === 3) return { label: "Medium",   colorClass: "bg-amber-500",   widthPct: 60 };
  if (score === 4) return { label: "Strong",   colorClass: "bg-lime-500",    widthPct: 80 };
  return             { label: "Excellent",     colorClass: "bg-emerald-600",  widthPct: 100 };
}

interface PasswordStrengthMeterProps {
  password: string;
}

/**
 * Visual strength meter + rule checklist for a password field.
 * Only renders when `password.length > 0`.
 *
 * Parents should call `evaluateStrength(password).allValid` to gate
 * their submit button without duplicating the rule logic.
 */
const PasswordStrengthMeter = ({ password }: PasswordStrengthMeterProps) => {
  if (password.length === 0) return null;

  const { score, passed } = evaluateStrength(password);
  const tier = strengthTier(score);

  return (
    <div className="space-y-3">
      {/* Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Password strength</span>
          <span className="font-medium">{tier.label}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${tier.colorClass}`}
            style={{ width: `${tier.widthPct}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <ul className="space-y-1.5">
        {PASSWORD_RULES.map((rule, i) => {
          const ok = passed[i];
          return (
            <li
              key={rule.label}
              className={`flex items-center gap-2 text-sm transition-colors ${
                ok ? "text-emerald-600" : "text-muted-foreground"
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
                  ok ? "bg-emerald-100" : "bg-muted"
                }`}
              >
                {ok ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                )}
              </span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PasswordStrengthMeter;
