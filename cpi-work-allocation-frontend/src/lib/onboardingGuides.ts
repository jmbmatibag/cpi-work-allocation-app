import { BookOpen, CalendarRange, ClipboardCheck, type LucideIcon } from "lucide-react";
import type { TipSection } from "@/components/WorkspaceTipModal";

/**
 * Single source of truth for the in-app onboarding guides.
 *
 * Each feature's first-run tip modal (WorkspaceTipModal) AND the centralized
 * Help center (/help) render from these definitions, so the copy never
 * diverges between the dismissable pop-up and the permanent reference page.
 *
 * `storageKey` matches the localStorage flag the per-page modal uses to
 * remember "Do not show again" — keep these in sync with the modal call sites.
 */
export interface OnboardingGuide {
  /** Stable id used for routing/anchors on the Help page. */
  id: string;
  /** localStorage key the first-run modal uses for its "do not show again" flag. */
  storageKey: string;
  /** Icon shown beside the guide on the Help page. */
  icon: LucideIcon;
  title: string;
  subtitle: string;
  tips: TipSection[];
  /** Optional muted footnote rendered below the tips. */
  note?: string;
}

export const ONBOARDING_GUIDES: OnboardingGuide[] = [
  {
    id: "daily-journal",
    storageKey: "hideDailyLogTip",
    icon: BookOpen,
    title: "How to use the Daily Journal",
    subtitle: "Log your work day as natural text — no forms, no timers.",
    tips: [
      {
        heading: "Use tagging shortcuts",
        body: "To ensure the system understands your log clearly, use tagging shortcuts (e.g., @ClientName and #CategoryName) when logging a project or client.",
      },
      {
        heading: "Timeline entries",
        body: 'Start a line with a time like "9:17am @ClientName #CategoryName – description" to record a timed block. Use @ for clients and # for categories.',
      },
      {
        heading: "Range entries",
        body: 'Write "9:00am to 11:30am @Client #Category – task" to span a specific window. The engine converts it to a time block automatically.',
      },
      {
        heading: "Multi-line continuation",
        body: "Lines without a timestamp extend the previous timed block. Great for listing sub-tasks under one work window.",
      },
      {
        heading: "Auto-inference",
        body: "Unrecognised @tags and #tags are flagged with a warning badge. An admin can map them in Settings so future entries resolve correctly.",
      },
    ],
    note: "You can view these tips at any time by clicking the 'Tips' button next to the Save Entry button.",
  },
  {
    id: "monthly-allocations",
    storageKey: "hideMonthlyAllocationsTip",
    icon: CalendarRange,
    title: "How to use Monthly Work Allocations",
    subtitle:
      "Build a structured breakdown of how your month was spent — then submit it for manager review.",
    tips: [
      {
        heading: "Auto-generate from your journal",
        body: 'Click "Auto-Generate from Daily Journal" to pull your Daily Journal entries for the selected month and pre-fill the allocation cards automatically.',
      },
      {
        heading: "Edit allocation cards",
        body: "Each card represents a Work Stream. Drag to reorder, click a card to expand it, and adjust percentages so the total reaches 100%.",
      },
      {
        heading: "Select the work period",
        body: "Use the month/year picker on the left sidebar to navigate between periods. Draft changes are saved automatically as you edit.",
      },
      {
        heading: "Submit for review",
        body: 'When you are satisfied, click "Submit for Review". Your manager will be notified and can approve or return it with feedback.',
      },
    ],
    note: 'A permanent Formatting Guide is available directly on the entry screen — look for the (!) info icon next to the "Enter Work Allocation Manually" heading to open it at any time.',
  },
  {
    id: "performance-summary",
    storageKey: "hidePerformanceSummaryTip",
    icon: ClipboardCheck,
    title: "How to use the Performance Summary",
    subtitle:
      "Generate an HR-ready accomplishment matrix from your approved monthly allocations.",
    tips: [
      {
        heading: "Select a timeframe",
        body: "Choose Q1–Q4, Mid-Year, or Annual. The report spans all approved allocations within that window for the selected employee.",
      },
      {
        heading: "Status thresholds",
        body: "Activities are rated Delivered (≥ 25%), On-Track (≥ 10%), or At-Risk (< 10%) based on their average allocation percentage across the period.",
      },
      {
        heading: "Corroborated by journal",
        body: "Daily journal entries are matched against each work stream to provide evidence notes alongside each accomplishment line.",
      },
      {
        heading: "Print or export to PDF",
        body: 'Click "Print / Save as PDF" to open the browser print dialog. The report hides navigation and filters automatically for a clean output.',
      },
    ],
  },
];

/** Look up a single guide by id. Throws in dev if the id is unknown. */
export const getOnboardingGuide = (id: string): OnboardingGuide => {
  const guide = ONBOARDING_GUIDES.find((g) => g.id === id);
  if (!guide) throw new Error(`Unknown onboarding guide: ${id}`);
  return guide;
};
