/**
 * Patch notes — single source of truth for the "What's New" modal AND the
 * /whats-new history page.
 *
 * Same arrangement as onboardingGuides.ts: one definition list feeds both the
 * one-time pop-up and the permanent reference page, so the two can never
 * disagree about what shipped.
 *
 * ── Publishing a release ────────────────────────────────────────────────────
 * 1. Add a new entry at the TOP of PATCH_NOTES (newest first).
 * 2. Bump its `version`. That string is the whole trigger: the modal fires for
 *    every user whose stored "last seen" differs from PATCH_NOTES[0].version.
 * 3. Deploy. Nothing else to do — no server flag, no DB row.
 *
 * Do NOT edit a published entry's `version` to fix a typo in its body; that
 * would re-open the modal for everyone. Only bump it for genuinely new notes.
 */

/**
 * localStorage key holding the last release version the user acknowledged.
 *
 * Deliberately stores the VERSION STRING, not a boolean — a boolean would
 * suppress every future release too. Namespaced `cpi.` to match the app's
 * other keys and to survive a targeted clear.
 */
export const PATCH_NOTES_SEEN_KEY = "cpi.patchNotesSeenVersion";

/** Category of a single line item. Drives its icon and colour. */
export type PatchChangeType = "new" | "improved" | "fixed" | "changed";

export interface PatchChange {
  type: PatchChangeType;
  /** One-line summary. Keep it in plain language — this is read by everyone. */
  text: string;
  /** Optional second line for the "why" or the how-to. */
  detail?: string;
  /**
   * Who the change is FOR. Defaults to "everyone".
   *
   * "admin" items are kept OUT of the pop-up — a config screen only Admins
   * can reach is noise to the ~40 people who just log their week, and a modal
   * padded with irrelevant lines stops being read. They still appear on
   * /whats-new (badged), so the record stays complete.
   */
  audience?: "everyone" | "admin";
}

export interface PatchNote {
  /** Bump to re-trigger the modal. Any unique string works; semver is a habit. */
  version: string;
  /** ISO date (YYYY-MM-DD). Rendered as a friendly date. */
  date: string;
  title: string;
  /** One-sentence framing shown under the title. */
  summary: string;
  changes: PatchChange[];
}

export const PATCH_CHANGE_LABELS: Record<PatchChangeType, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
  changed: "Changed",
};

/**
 * Newest first. PATCH_NOTES[0] is what the modal shows.
 */
export const PATCH_NOTES: PatchNote[] = [
  {
    version: "1.4.0",
    date: "2026-09-01",
    title: "Enhancement tagging & a flatter project taxonomy",
    summary:
      "Specific Enhancement work can now be tagged from a fixed list instead of free text, and projects have been promoted out of the Projects category.",
    changes: [
      {
        type: "new",
        text: "Tag Specific Enhancements with $EnhancementName",
        detail:
          "Type $ in the Daily Journal or the Monthly Allocations entry box and pick from the list — for example \"$AXA-MTC payout screen fix\". You can also set it on an allocation card: choose Specific Enhancement as the Work Type and an Enhancement dropdown appears.",
      },
      {
        type: "new",
        text: "Enhancement is now its own column in exports",
        detail:
          "Both the Excel/PDF export and the Finance export carry it, so Finance no longer has to read enhancement names out of the description text.",
      },
      {
        type: "changed",
        text: "Projects are now Main Categories",
        detail:
          "Geniisys and the other projects previously nested under the Projects category are now Main Categories in their own right. Existing allocations were migrated automatically — nothing to redo.",
      },
      {
        type: "new",
        text: "Admins can manage the enhancement list",
        detail:
          "Settings → Taxonomy → Enhancements. Renaming an enhancement updates every allocation already tagged with it.",
        audience: "admin",
      },
      {
        type: "improved",
        text: "Unrecognised tags are easier to spot",
        detail:
          "The \"Detected\" strip under the Daily Journal editor now flags $ tags too. An unrecognised enhancement is ignored rather than saved, so check for the warning badge before saving.",
      },
      {
        type: "fixed",
        text: "Lowercase tags now highlight correctly",
        detail:
          "Typing @auii or #geniisys in lowercase always worked, but showed no colour. All three tag types now highlight regardless of case.",
      },
    ],
  },
];

/** The release the modal will show. */
export const LATEST_PATCH_NOTE = PATCH_NOTES[0];

/** Items the pop-up shows: everything except Admin-only configuration notes. */
export function userFacingChanges(note: PatchNote): PatchChange[] {
  return note.changes.filter((c) => (c.audience ?? "everyone") === "everyone");
}

/**
 * Whether to show the modal for a given stored value.
 *
 * A user with NO stored value is treated as "hasn't seen it" and gets the
 * latest note. That is intentional: on the first deploy of this feature
 * nobody has the key yet, and every existing user should see what changed.
 * The cost is that a brand-new hire also sees the most recent note once,
 * which reads as a reasonable introduction rather than a bug.
 */
export function shouldShowPatchNotes(lastSeenVersion: string | null): boolean {
  if (!LATEST_PATCH_NOTE) return false;
  // An Admin-only release has nothing to say to most users, so it must not
  // raise an empty pop-up. It still lands on /whats-new.
  if (userFacingChanges(LATEST_PATCH_NOTE).length === 0) return false;
  return lastSeenVersion !== LATEST_PATCH_NOTE.version;
}

/** "2026-09-01" -> "1 September 2026". Falls back to the raw string. */
export function formatPatchDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
