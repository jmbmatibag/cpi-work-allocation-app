import { BookOpen, CalendarRange, ClipboardCheck, type LucideIcon } from "lucide-react";
import type { TipSection } from "@/components/WorkspaceTipModal";
// Imported rather than hardcoded: the guide copy and the parser must never
// disagree about which character starts an enhancement tag.
import { ENHANCEMENT_SIGIL } from "@/lib/tagHighlight";

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
        body: `To ensure the system understands your log clearly, use tagging shortcuts when logging a project or client: @ClientName for a client, #CategoryName for a work category, and ${ENHANCEMENT_SIGIL}EnhancementName for a specific enhancement. Typing any of the three opens a suggestion list.`,
      },
      {
        heading: "Tag a specific enhancement",
        body: `When the work is a Specific Enhancement, add ${ENHANCEMENT_SIGIL}EnhancementName — for example "9:17am @AUII #Geniisys ${ENHANCEMENT_SIGIL}AXA-MTC payout fix". Only names on the Admin roster (Settings → Taxonomy → Enhancements) are recognised; anything else stays plain text. Tagging it here carries straight through to your monthly allocation and to Finance's Enhancement column.`,
      },
      {
        heading: "Timeline entries",
        body: `Start a line with a time like "9:17am @ClientName #CategoryName – description" to record a timed block. Use @ for clients, # for categories, and ${ENHANCEMENT_SIGIL} for enhancements.`,
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
        body: `Every tag you type appears in the "Detected" strip below the editor. Unrecognised ones are flagged with a warning badge — hover it for details. An admin can map them in Settings so future entries resolve correctly.`,
      },
      {
        heading: "What an unrecognised tag does",
        body: `The three tags behave differently when they aren't registered. An unknown @client still reaches your allocation card as a custom client. An unknown #category falls back to keyword classification. An unknown ${ENHANCEMENT_SIGIL}enhancement is IGNORED outright — it stays plain text and Finance's Enhancement column comes out blank, so check the badge before saving.`,
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
        heading: "Tag a specific enhancement",
        body: `In the manual entry box, add ${ENHANCEMENT_SIGIL}EnhancementName to a line whose work type is Specific Enhancement — e.g. "#Geniisys Specific Enhancement ${ENHANCEMENT_SIGIL}AXA-MTC — payout screen fix @AXA". The card arrives pre-tagged. You can also set it on the card itself: choose Specific Enhancement as the Work Type and an Enhancement dropdown appears.`,
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
