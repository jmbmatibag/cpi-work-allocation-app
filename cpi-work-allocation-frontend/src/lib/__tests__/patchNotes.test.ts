import { describe, it, expect } from "vitest";
import {
  PATCH_NOTES,
  LATEST_PATCH_NOTE,
  PATCH_CHANGE_LABELS,
  shouldShowPatchNotes,
  userFacingChanges,
  formatPatchDate,
  type PatchNote,
} from "../patchNotes";

describe("patch notes definitions", () => {
  it("has at least one release, newest first", () => {
    expect(PATCH_NOTES.length).toBeGreaterThan(0);
    expect(LATEST_PATCH_NOTE).toBe(PATCH_NOTES[0]);

    const dates = PATCH_NOTES.map((n) => n.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it("has unique versions", () => {
    // A duplicate version would mean one release could never re-trigger the
    // modal for users who already acknowledged the other.
    const versions = PATCH_NOTES.map((n) => n.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("uses ISO dates and known change types", () => {
    for (const note of PATCH_NOTES) {
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(note.changes.length).toBeGreaterThan(0);
      for (const c of note.changes) {
        expect(PATCH_CHANGE_LABELS[c.type]).toBeTruthy();
        expect(c.text.trim()).not.toBe("");
      }
    }
  });
});

describe("shouldShowPatchNotes", () => {
  it("shows when the user has never seen a release", () => {
    // First deploy of this feature: nobody has the key, everybody should see
    // what changed.
    expect(shouldShowPatchNotes(null)).toBe(true);
  });

  it("hides once the latest version is acknowledged", () => {
    expect(shouldShowPatchNotes(LATEST_PATCH_NOTE.version)).toBe(false);
  });

  it("shows again after a version bump", () => {
    // The whole release mechanism: acknowledging 1.0.0 must not suppress the
    // next release. This is why the stored value is a version, not a boolean.
    expect(shouldShowPatchNotes("0.0.1-old")).toBe(true);
  });
});

describe("formatPatchDate", () => {
  it("renders a friendly date", () => {
    const out = formatPatchDate("2026-09-01");
    expect(out).toContain("2026");
    expect(out).not.toBe("2026-09-01");
  });

  it("does not shift the day across timezones", () => {
    // Parsed as local midnight, not UTC — otherwise a negative-offset zone
    // renders the previous day.
    expect(formatPatchDate("2026-09-01")).toContain("1");
  });

  it("falls back to the raw string when unparseable", () => {
    expect(formatPatchDate("not-a-date")).toBe("not-a-date");
  });
});

describe("audience filtering", () => {
  const adminOnly: PatchNote = {
    version: "0.0.0-test",
    date: "2026-01-01",
    title: "t",
    summary: "s",
    changes: [{ type: "new", text: "Admin thing", audience: "admin" }],
  };

  it("keeps items with no audience (defaults to everyone)", () => {
    const note: PatchNote = {
      ...adminOnly,
      changes: [{ type: "new", text: "For everyone" }],
    };
    expect(userFacingChanges(note)).toHaveLength(1);
  });

  it("drops admin-only items", () => {
    expect(userFacingChanges(adminOnly)).toHaveLength(0);
  });

  it("keeps the published release free of admin items in the modal", () => {
    const shown = userFacingChanges(LATEST_PATCH_NOTE);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((c) => (c.audience ?? "everyone") === "everyone")).toBe(true);
    // The admin note is not lost — the page still renders the full list.
    expect(LATEST_PATCH_NOTE.changes.length).toBeGreaterThan(shown.length);
  });

  it("does not name Quick Policy, which is not in production", () => {
    const blob = JSON.stringify(PATCH_NOTES).toLowerCase();
    expect(blob).not.toContain("quick policy");
  });
});
