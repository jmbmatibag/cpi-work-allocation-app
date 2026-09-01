import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PatchNotesModal from "@/components/PatchNotesModal";
import { LATEST_PATCH_NOTE, PATCH_NOTES_SEEN_KEY } from "@/lib/patchNotes";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

import { useAuth } from "@/contexts/AuthContext";
const mockedAuth = vi.mocked(useAuth);

/**
 * Three independent gates decide whether the pop-up appears, and getting any
 * of them wrong makes the feature silently do nothing — which is exactly how
 * it shipped broken for Admins the first time. These pin all three.
 */

function signInAs(roles: string[]) {
  mockedAuth.mockReturnValue({
    currentUser: { id: "U1", roles },
  } as unknown as ReturnType<typeof useAuth>);
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PatchNotesModal />
    </MemoryRouter>,
  );
}

const TITLE = /patch update/i;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("PatchNotesModal — when it opens", () => {
  it("opens on the landing screen for a workspace user", () => {
    signInAs(["Employee"]);
    renderAt("/dashboard");
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it("opens on /employees for an Admin, who cannot reach /dashboard", () => {
    // Regression: hardcoding /dashboard meant Admins never saw a release note.
    signInAs(["Admin"]);
    renderAt("/employees");
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it("stays shut on a non-landing page", () => {
    signInAs(["Employee"]);
    renderAt("/journal");
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it("stays shut once the release was permanently dismissed", () => {
    localStorage.setItem(PATCH_NOTES_SEEN_KEY, LATEST_PATCH_NOTE.version);
    signInAs(["Employee"]);
    renderAt("/dashboard");
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it("still opens when a DIFFERENT release was dismissed", () => {
    // Dismissing v1.4.0 must never mute v1.5.0.
    localStorage.setItem(PATCH_NOTES_SEEN_KEY, "0.0.1-previous");
    signInAs(["Employee"]);
    renderAt("/dashboard");
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });

  it("opens only once per browser session", () => {
    signInAs(["Employee"]);
    const first = renderAt("/dashboard");
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    first.unmount();

    // A reload in the same session: sessionStorage still carries the mark.
    renderAt("/dashboard");
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });
});

describe("PatchNotesModal — dismissal", () => {
  it("closing without the checkbox does NOT persist", () => {
    signInAs(["Employee"]);
    renderAt("/dashboard");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    // Nothing written: the note returns in the user's next session.
    expect(localStorage.getItem(PATCH_NOTES_SEEN_KEY)).toBeNull();
  });

  it("ticking 'Do not show again' persists the version", () => {
    signInAs(["Employee"]);
    renderAt("/dashboard");

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    expect(localStorage.getItem(PATCH_NOTES_SEEN_KEY)).toBe(
      LATEST_PATCH_NOTE.version,
    );
  });
});

describe("PatchNotesModal — content", () => {
  it("lists user-facing changes and hides Admin-only ones", () => {
    signInAs(["Employee"]);
    renderAt("/dashboard");

    expect(screen.getByText(/what's new/i)).toBeInTheDocument();
    // The v1.4.0 admin item must not reach the pop-up.
    expect(
      screen.queryByText(/admins can manage the enhancement list/i),
    ).not.toBeInTheDocument();
  });
});
