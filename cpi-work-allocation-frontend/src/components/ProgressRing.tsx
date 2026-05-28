interface ProgressRingProps {
  percentage: number;
}

/**
 * Visual summary of the current % allocated.
 *
 * Drawn as native SVG rather than Recharts — Recharts reserves
 * internal padding for labels/legends that can't be fully suppressed,
 * which produced a small off-center glitch where the centered text
 * overlay didn't line up with the pie's geometric center. Native SVG
 * gives us pixel-perfect control over the geometry.
 *
 * Color semantics:
 *   > 100%     destructive red  (was green — indistinguishable from
 *                                "complete" pre-fix)
 *   == 100%    success green
 *   75–99%     blue             (on track)
 *   50–74%     amber            (warning)
 *   < 50%      destructive red  (under-allocated)
 */
const SIZE = 180;
const STROKE_WIDTH = 20;
// Radius is centered in the stroke (path sits on the centerline),
// so inset by half the stroke to keep the full width inside the box.
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

const ProgressRing = ({ percentage }: ProgressRingProps) => {
  const actual = parseFloat(percentage.toFixed(2));
  const isOver = actual > 100;
  const isComplete = actual === 100;

  // Draw a fully-filled ring for both complete and over-allocated
  // states — the stroke color distinguishes them, not the fill amount.
  const fillRatio = isOver ? 1 : Math.max(0, Math.min(1, actual / 100));
  const dashOffset = CIRCUMFERENCE * (1 - fillRatio);

  const strokeColor =
    isOver         ? "hsl(var(--destructive))"   // red — too much
    : isComplete   ? "#22c55e"                    // green — done
    : actual >= 75 ? "#3b82f6"                    // blue — on track
    : actual >= 50 ? "#f59e0b"                    // amber — warning
    :                "hsl(var(--destructive))";   // red — too little

  return (
    <div className="border rounded-xl p-5 bg-card">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Allocation Progress
      </p>
      <div className="flex flex-col items-center">
        {/* Ring + centered label share one positioning box of exactly
            SIZE × SIZE pixels so they align perfectly. */}
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="-rotate-90"
          >
            {/* Track — the un-filled remainder */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={STROKE_WIDTH}
            />
            {/* Progress fill — strokeDasharray + strokeDashoffset
                hides the portion of the circumference we haven't filled */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={strokeColor}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="butt"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{
                transition:
                  "stroke-dashoffset 400ms ease-out, stroke 200ms ease-out",
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-foreground tabular-nums">
              {actual}%
            </span>
            <span className="text-xs text-muted-foreground">of 100%</span>
          </div>
        </div>

        {isOver && (
          <p className="text-sm text-destructive mt-2 font-medium">
            ⚠ Over-allocated by {parseFloat((actual - 100).toFixed(2))}%.
          </p>
        )}
        {isComplete && (
          <p className="text-sm text-green-600 mt-2 font-medium">
            ✓ Fully allocated!
          </p>
        )}
        {!isComplete && !isOver && (
          <p className="text-sm text-amber-500 mt-2 font-medium">
            ⓘ You need {parseFloat((100 - actual).toFixed(2))}% more to submit.
          </p>
        )}
      </div>
    </div>
  );
};

export default ProgressRing;
