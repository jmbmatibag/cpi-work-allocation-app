import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Users } from "lucide-react";

/**
 * Executive Summary Dashboard (Epic 1).
 *
 * One card per Team/Manager group summarising allocation compliance for
 * the selected period. The data is aggregated upstream in
 * CompanyMasterOverview from the same raw allocation store the master
 * table reads, so the cards never drift from the table below them.
 *
 * "Approved %" is approved employees over the total headcount of that
 * team-manager group (including people who never started), which is the
 * compliance figure Finance cares about — not approved-over-submitted.
 */
export interface TeamSummary {
  /** Stable composite key: `${team}::${managerId ?? "none"}`. */
  key: string;
  team: string;
  /** null = top of reporting chain (no in-app manager). */
  managerId: string | null;
  managerName: string;
  /** Total employees in the group (denominator for the progress bar). */
  total: number;
  approved: number;
  pendingReview: number;
  needsRevision: number;
  draft: number;
  /** No allocation record at all for the period (Blank / Not Started). */
  notStarted: number;
  /** approved / total, rounded to a whole percent. */
  approvedPct: number;
}

/** Compact count badge used in the mini-stat row. */
const StatBadge = ({
  count,
  label,
  className,
  variant,
}: {
  count: number;
  label: string;
  className?: string;
  variant?: "outline";
}) => (
  <Badge variant={variant} className={className}>
    <span className="tabular-nums font-semibold">{count}</span>
    <span className="ml-1 font-normal opacity-90">{label}</span>
  </Badge>
);

export const TeamSummaryCards = ({ summaries }: { summaries: TeamSummary[] }) => {
  if (summaries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No teams to summarise for the selected period.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">
          Team Compliance Summary
        </h2>
        <span className="text-xs text-muted-foreground">
          {summaries.length} {summaries.length === 1 ? "team" : "teams"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((s) => {
          const complete = s.approvedPct >= 100;
          return (
            <Card key={s.key}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate" title={s.team}>
                      {s.team}
                    </CardTitle>
                    <p
                      className="text-xs text-muted-foreground truncate"
                      title={s.managerName}
                    >
                      {s.managerName}
                    </p>
                  </div>
                  <span
                    className={`text-2xl font-bold tabular-nums ${
                      complete ? "text-success" : "text-foreground"
                    }`}
                  >
                    {s.approvedPct}%
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Progress value={s.approvedPct} className="h-2" />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {s.approved} of {s.total} approved
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatBadge
                    count={s.approved}
                    label="Approved"
                    className="bg-success/10 text-success hover:bg-success/10"
                  />
                  <StatBadge
                    count={s.pendingReview}
                    label="Pending Review"
                    className="bg-warning/10 text-warning hover:bg-warning/10"
                  />
                  {s.needsRevision > 0 && (
                    <StatBadge
                      count={s.needsRevision}
                      label="Needs Revision"
                      className="bg-destructive/10 text-destructive hover:bg-destructive/10"
                    />
                  )}
                  <StatBadge
                    count={s.draft}
                    label="Draft"
                    className="bg-muted text-muted-foreground hover:bg-muted"
                  />
                  <StatBadge
                    count={s.notStarted}
                    label="Not Started"
                    variant="outline"
                    className="text-destructive border-destructive/30"
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
