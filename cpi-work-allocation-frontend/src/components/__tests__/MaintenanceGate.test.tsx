import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MaintenanceGate from "@/components/MaintenanceGate";

vi.mock("@/hooks/useMaintenanceStatus", () => ({
  useMaintenanceStatus: vi.fn(),
  useUpdateMaintenance: vi.fn(),
  isApiMode: () => true,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useMaintenanceStatus } from "@/hooks/useMaintenanceStatus";
import { useAuth } from "@/contexts/AuthContext";

const mockedStatus = vi.mocked(useMaintenanceStatus);
const mockedAuth = vi.mocked(useAuth);

const APP_MARKER = "the-real-app";
const ANNOUNCEMENT = /scheduled maintenance/i;

function setMaintenance(enabled: boolean, isLoading = false) {
  mockedStatus.mockReturnValue({
    status: {
      enabled,
      title: "Scheduled Maintenance",
      message: "Back soon.",
      startsAt: null,
      endsAt: null,
      updatedAt: "2026-08-24T00:00:00.000Z",
      updatedByName: null,
    },
    isLoading,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMaintenanceStatus>);
}

function setUser(roles: string[] | null, isLoading = false) {
  mockedAuth.mockReturnValue({
    currentUser: roles ? { id: "U1", roles } : null,
    isLoading,
  } as unknown as ReturnType<typeof useAuth>);
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MaintenanceGate>
        <div>{APP_MARKER}</div>
      </MaintenanceGate>
    </MemoryRouter>,
  );
}

describe("MaintenanceGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the app when maintenance is off", () => {
    setMaintenance(false);
    setUser(["Employee"]);
    renderAt("/dashboard");
    expect(screen.getByText(APP_MARKER)).toBeInTheDocument();
  });

  it("replaces the app with the announcement for a non-Admin", () => {
    setMaintenance(true);
    setUser(["Employee", "Manager"]);
    renderAt("/dashboard");
    expect(screen.queryByText(APP_MARKER)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ANNOUNCEMENT })).toBeInTheDocument();
  });

  it("gates a signed-out visitor too", () => {
    setMaintenance(true);
    setUser(null);
    renderAt("/dashboard");
    expect(screen.queryByText(APP_MARKER)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ANNOUNCEMENT })).toBeInTheDocument();
  });

  it("lets an Admin through the gate", () => {
    setMaintenance(true);
    setUser(["Admin"]);
    renderAt("/dashboard");
    expect(screen.getByText(APP_MARKER)).toBeInTheDocument();
  });

  it("lets a multi-role user with Admin through", () => {
    setMaintenance(true);
    setUser(["Employee", "Admin"]);
    renderAt("/dashboard");
    expect(screen.getByText(APP_MARKER)).toBeInTheDocument();
  });

  it.each(["/login", "/setup-password", "/reset-password", "/maintenance"])(
    "keeps %s reachable during maintenance",
    (path) => {
      setMaintenance(true);
      setUser(null);
      renderAt(path);
      expect(screen.getByText(APP_MARKER)).toBeInTheDocument();
    },
  );

  it("fails open while the first status poll is in flight", () => {
    setMaintenance(false, true);
    setUser(["Employee"]);
    renderAt("/dashboard");
    expect(screen.getByText(APP_MARKER)).toBeInTheDocument();
  });

  it("shows neither app nor announcement while the session is resolving", () => {
    setMaintenance(true);
    setUser(null, true);
    renderAt("/dashboard");
    expect(screen.queryByText(APP_MARKER)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: ANNOUNCEMENT })).not.toBeInTheDocument();
  });
});
