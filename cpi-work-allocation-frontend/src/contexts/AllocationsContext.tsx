import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkStreamData } from "@/components/Workspace";
import { getDataClient } from "@/lib/dataClient";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/contexts/AuthContext";

export type AllocationStatus =
  | "Draft"
  | "Pending Review"
  | "Approved"
  | "Needs Revision";

export interface ActivityFlag {
  reason: string;
  flaggedAt: string;
}

export interface AllocationRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  team: string;
  /**
   * Id of the manager who owns this record for review purposes.
   * All filtering (Team Hub, approval routing) keys off this id.
   * `managerName` is kept for display only.
   */
  managerId: string;
  managerName: string;
  month: string;
  year: string;
  monthIndex: number;
  streams: WorkStreamData[];
  status: AllocationStatus;
  submittedAt?: string;
  reviewedAt?: string;
  feedback?: string;
  flags?: Record<string, ActivityFlag>;
  /**
   * Audit stamp for manager-side edits during review (Phase K).
   * Set whenever someone other than the employee modifies the
   * record's streams. Read-only for consumers — assigned by the
   * managerEdit method on this context.
   *
   * The employee's own saves do NOT set this — employee-origin
   * changes are their baseline, not "edits" in the audit sense.
   */
  lastEditedBy?: {
    userId: string;
    userName: string;
    at: string;
  };
  /**
   * Peer Coverage accountability — who ACTUALLY approved or returned this
   * record. Under peer coverage the actor may differ from `managerId` (the
   * assigned manager). Read-only; assigned by the backend on approve/return.
   * The display verb ("Approved by" / "Returned by") is derived from
   * `status`, so this only carries identity + timestamp.
   */
  actionedBy?: {
    userId: string;
    userName: string;
    at: string;
  };
}

interface AllocationsContextType {
  records: AllocationRecord[];
  /**
   * True once the records list reflects a settled load — i.e. the first
   * fetch has resolved (API mode) or the synchronous seed is in place
   * (local mode). Consumers that must NOT act on an empty-because-still-
   * loading list (notably the login reminder scheduler, which would
   * otherwise mistake "not fetched yet" for "no allocation → nudge to
   * submit") gate on this instead of on `records.length`.
   */
  isLoaded: boolean;
  getRecord: (employeeId: string, month: string, year: string) => AllocationRecord | undefined;
  upsertDraft: (
    rec: Omit<AllocationRecord, "status" | "flags"> & { status?: AllocationStatus },
  ) => void;
  /**
   * Flip Draft→Pending Review. The optional `streams` argument lets the
   * caller commit the final card state in the same backend transaction
   * as the status flip.
   *
   * Returns a promise so the caller can await both the upsert (if the
   * record doesn't exist in the local cache yet) AND the submit before
   * showing the success UI. Without awaiting the upsert, the
   * autosave-vs-submit race would leave a record in Draft with empty
   * cards (or no record at all) when the user clicks Submit before the
   * latest autosave round-trip has landed.
   *
   * The resolved string is the record id (or "" if the submit could
   * not be performed — e.g. caller passed neither cached record nor
   * streams to upsert).
   */
  submitForReview: (
    employeeId: string,
    month: string,
    year: string,
    streams?: WorkStreamData[],
  ) => Promise<string>;
  /**
   * Approve a submission. Resolves on success; REJECTS on failure so the
   * caller can surface it — notably the Peer Coverage 409 ("already actioned
   * by another manager") when a peer beat this reviewer to it.
   */
  approve: (recordId: string) => Promise<void>;
  /**
   * Return a submission for revision. Resolves on success; rejects on
   * failure (see {@link approve} for the concurrency-conflict case).
   */
  returnForRevision: (recordId: string, feedback?: string) => Promise<void>;
  getRecordsForManager: (managerId: string, team?: string) => AllocationRecord[];
  getApprovedForEmployee: (
    employeeId: string,
    fromMonthIdx: number,
    fromYear: number,
    toMonthIdx: number,
    toYear: number,
  ) => AllocationRecord[];
  /**
   * All records for an employee sorted chronologically (oldest first).
   * Callers filter by status client-side. Use this for dashboard trend
   * charts, submission histories, and "last activity" computations.
   */
  getHistoryForEmployee: (employeeId: string) => AllocationRecord[];
  flagActivity: (recordId: string, activityId: string, reason: string) => void;
  unflagActivity: (recordId: string, activityId: string) => void;
  /**
   * Manager-side edit during review (Phase K). Writes the updated
   * streams, stamps lastEditedBy, and by default clears all flags
   * (the edit is the fix; stale flags on changed activities would
   * be confusing). Pass `keepFlags: true` if the manager wants to
   * edit without clearing flags — rare case.
   *
   * Refuses to edit Approved records (terminal status); dev-only
   * warn. Refuses if the editor isn't the assigned manager.
   */
  managerEdit: (
    recordId: string,
    streams: WorkStreamData[],
    editor: { userId: string; userName: string },
    options?: { keepFlags?: boolean },
  ) => void;

  /**
   * Rename a team across all allocation records. Rewrites the
   * top-level `team` field on every record whose `team === oldName`.
   * Called by Admin Settings after a team rename in ClientsConfig.
   *
   * No-op if no records match or if old/new are equal.
   */
  renameTeam: (oldName: string, newName: string) => void;

  /**
   * Rename a client across all allocation records. Rewrites the
   * `client` field on every activity (across every stream of every
   * record) whose `client === oldName`. Called by Admin Settings
   * after a client rename in ClientsConfig.
   *
   * No-op if no activities match or if old/new are equal.
   */
  renameClient: (oldName: string, newName: string) => void;
}

const AllocationsContext = createContext<AllocationsContextType | undefined>(undefined);

export const useAllocations = () => {
  const ctx = useContext(AllocationsContext);
  if (!ctx) throw new Error("useAllocations must be used within AllocationsProvider");
  return ctx;
};

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const seedStreams = (
  data: {
    category: string;
    activities: {
      workType: string;
      client: string;
      description: string;
      percentage: number;
      /**
       * Phase P: optional sub category. All current seed records
       * use main-category-only activities (IT, General Work, etc.),
       * so this is null in practice. Here for future seeds that
       * want Geniisys/Quick Policy etc.
       */
      subCategory?: string | null;
    }[];
  }[],
): WorkStreamData[] =>
  data.map((s) => ({
    category: s.category,
    expanded: false,
    activities: s.activities.map((a) => ({
      id: crypto.randomUUID(),
      team: "IT/Platforms",
      workCategory: s.category,
      subCategory: a.subCategory ?? null,
      workType: a.workType,
      // Seed data carries no enhancement tags; they are picked on the card.
      enhancementTag: null,
      client: a.client,
      description: a.description,
      percentage: a.percentage,
      expanded: false,
    })),
  }));

/**
 * Seeded for manager-review testing.
 *
 * Jose Escobar (EMP001) is intentionally left unseeded so every month
 * renders the ✨ Auto-Generate prompt box for testing the AI
 * aggregation flow against his 55 journal entries.
 *
 * Carlos Garcia (EMP004) and Kim Ramos (EMP011) are seeded so Carlos
 * Reyes (manager) has something to review in Team Hub and so the
 * Performance Review matrix has approved records to render:
 *
 *   Carlos Garcia: Jan / Feb / Mar / Apr all Approved
 *   Kim Ramos:     Feb / Mar Approved, Apr Pending Review
 *
 * Expected Team Hub totals under Carlos Reyes:
 *   Pending Review: 1 (Kim April)
 *   Approved: 6 (Carlos Garcia x4, Kim x2)
 *   Needs Revision: 0 — generate via the real flag→return flow
 *                       rather than pre-seeding fake flags.
 *
 * To restore a "world has never been submitted" state for flow
 * testing, swap this array for [].
 */
const seedRecords: AllocationRecord[] = [

  // ═══════════════════════════════════════════════════════════════════
  // Carlos Garcia (EMP004) — Security Engineer, IT/Platforms
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "ALC-2026-1020",
    employeeId: "EMP004", employeeName: "Carlos Garcia", employeeEmail: "carlos@cpi.com.ph",
    team: "IT/Platforms", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "January", year: "2026", monthIndex: 0,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "Security", client: "AUII",   description: "Annual security posture review and gap analysis", percentage: 40 },
        { workType: "Security", client: "PNBGEN", description: "OWASP Top 10 compliance sweep for banking endpoints", percentage: 25 },
        { workType: "Infrastructure", client: "Internal", description: "Server patching and vulnerability remediation", percentage: 15 },
      ]},
      { category: "Projects", activities: [
        { workType: "Implementation", client: "AUII", description: "@AUII #Geniisys Security module integration", percentage: 12, subCategory: "Geniisys" },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings",      client: "Internal", description: "Security steering committee and sprint planning", percentage: 8 },
      ]},
    ]),
    status: "Approved", submittedAt: "2026-01-31T14:00:00Z", reviewedAt: "2026-02-04T10:30:00Z",
  },

  {
    id: "ALC-2026-1021",
    employeeId: "EMP004",
    employeeName: "Carlos Garcia",
    employeeEmail: "carlos@cpi.com.ph",
    team: "IT/Platforms",
    managerId: "HEAD001",
    managerName: "Roberto Cruz",
    month: "February",
    year: "2026",
    monthIndex: 1,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "Security", client: "AUII", description: "Penetration test — findings and remediation", percentage: 50 },
        { workType: "Security", client: "UCPB", description: "IAM policy audit", percentage: 20 },
      ]},
      { category: "General Work", activities: [
        { workType: "Documentation", client: "Internal", description: "Incident response runbook updates", percentage: 20 },
        { workType: "Communication", client: "Internal", description: "Cross-team security briefings", percentage: 10 },
      ]},
    ]),
    status: "Approved",
    submittedAt: "2026-02-27T11:15:00Z",
    reviewedAt: "2026-03-02T10:00:00Z",
  },

  {
    id: "ALC-2026-1022",
    employeeId: "EMP004",
    employeeName: "Carlos Garcia",
    employeeEmail: "carlos@cpi.com.ph",
    team: "IT/Platforms",
    managerId: "HEAD001",
    managerName: "Roberto Cruz",
    month: "March",
    year: "2026",
    monthIndex: 2,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "Security", client: "PNBGEN", description: "Quarterly vulnerability scan and report", percentage: 40 },
        { workType: "Security", client: "CPAIC", description: "Firewall rule cleanup and DNS hardening", percentage: 30 },
      ]},
      { category: "General Work", activities: [
        { workType: "Training", client: "Internal", description: "Security awareness training delivery", percentage: 15 },
        { workType: "Meetings", client: "Internal", description: "SOC 2 prep meetings", percentage: 15 },
      ]},
    ]),
    status: "Approved",
    submittedAt: "2026-03-31T13:00:00Z",
    reviewedAt: "2026-04-03T09:00:00Z",
  },

    {
    id: "ALC-2026-1023",
    employeeId: "EMP004",
    employeeName: "Carlos Garcia",
    employeeEmail: "carlos@cpi.com.ph",
    team: "IT/Platforms",
    managerId: "HEAD001",
    managerName: "Roberto Cruz",
    month: "April",
    year: "2026",
    monthIndex: 3,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "Security", client: "Internal", description: "Penetration testing and audit", percentage: 60 },
      ]},
      { category: "General Work", activities: [
        { workType: "Communication", client: "Internal", description: "Cross-team coordination", percentage: 40 },
      ]},
    ]),
    status: "Draft",
  },

  // ═══════════════════════════════════════════════════════════════════
  // Kim Ramos (EMP011) — IT Support, IT/Platforms
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "ALC-2026-1010",
    employeeId: "EMP011", employeeName: "Kim Ramos", employeeEmail: "kim@cpi.com.ph",
    team: "IT/Platforms", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "February", year: "2026", monthIndex: 1,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "Helpdesk",       client: "Internal", description: "Tier-2 support tickets; M365 sync issues dominated", percentage: 45 },
        { workType: "Networking",     client: "Internal", description: "Office switch firmware upgrades", percentage: 20 },
        { workType: "Infrastructure", client: "Internal", description: "Backup verification and monitoring setup", percentage: 15 },
      ]},
      { category: "Projects", activities: [
        { workType: "Support", client: "AUII", description: "@AUII #Geniisys helpdesk integration support", percentage: 10, subCategory: "Geniisys" },
      ]},
      { category: "General Work", activities: [
        { workType: "Training", client: "Internal", description: "CCNA study block and Cisco labs", percentage: 10 },
      ]},
    ]),
    status: "Approved", submittedAt: "2026-02-28T15:30:00Z", reviewedAt: "2026-03-03T11:00:00Z",
  },

  {
    id: "ALC-2026-1011",
    employeeId: "EMP011", employeeName: "Kim Ramos", employeeEmail: "kim@cpi.com.ph",
    team: "IT/Platforms", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "March", year: "2026", monthIndex: 2,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "Helpdesk",       client: "Internal", description: "Tier-2 support queue — onboarding new hires", percentage: 40 },
        { workType: "Networking",     client: "Internal", description: "WiFi coverage survey and remediation", percentage: 20 },
        { workType: "Infrastructure", client: "Internal", description: "DR drill and backup restore validation", percentage: 15 },
      ]},
      { category: "Projects", activities: [
        { workType: "Support",        client: "CPAIC", description: "@CPAIC #Geniisys Quick Policy client environment setup", percentage: 15, subCategory: "Geniisys" },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings",   client: "Internal", description: "IT team sync and capacity planning", percentage: 10 },
      ]},
    ]),
    status: "Approved", submittedAt: "2026-03-30T16:15:00Z", reviewedAt: "2026-04-02T09:00:00Z",
  },

  {
    id: "ALC-2026-1012",
    employeeId: "EMP011", employeeName: "Kim Ramos", employeeEmail: "kim@cpi.com.ph",
    team: "IT/Platforms", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "April", year: "2026", monthIndex: 3,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "Helpdesk",   client: "Internal", description: "Tier-2 support tickets and escalations", percentage: 40 },
        { workType: "Networking", client: "Internal", description: "Office network upgrades and VPN troubleshooting", percentage: 20 },
      ]},
      { category: "Projects", activities: [
        { workType: "Support",   client: "AUII",  description: "@AUII #Geniisys end-user support and training",      percentage: 25, subCategory: "Geniisys" },
        { workType: "Testing",   client: "AUII",  description: "@AUII #Geniisys regression testing post-deployment", percentage: 5,  subCategory: "Geniisys" },
      ]},
      { category: "General Work", activities: [
        { workType: "Training", client: "Internal", description: "Cisco certification prep — lab sessions", percentage: 10 },
      ]},
    ]),
    status: "Pending Review", submittedAt: "2026-04-14T16:00:00Z",
  },

  // ═══════════════════════════════════════════════════════════════════
  // Jose Escobar (EMP001) — Software Engineer, IT/Platforms
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "ALC-2026-1030",
    employeeId: "EMP001", employeeName: "Jose Escobar", employeeEmail: "jose@cpi.com.ph",
    team: "IT/Platforms", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "March", year: "2026", monthIndex: 2,
    streams: seedStreams([
      { category: "Projects", activities: [
        { workType: "Implementation", client: "AUII",   description: "@AUII #Geniisys core API development sprint", percentage: 35, subCategory: "Geniisys" },
        { workType: "Enhancement",   client: "AUII",   description: "@AUII #Geniisys claims workflow refactor",     percentage: 20, subCategory: "Geniisys" },
        { workType: "Implementation", client: "PNBGEN", description: "@PNBGEN #Geniisys Quick Policy engine build",  percentage: 20, subCategory: "Quick Policy" },
      ]},
      { category: "IT", activities: [
        { workType: "DevOps",        client: "Internal", description: "CI/CD pipeline setup for Geniisys deployments", percentage: 15 },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings",      client: "Internal", description: "Sprint planning, standups, retrospectives", percentage: 10 },
      ]},
    ]),
    status: "Approved", submittedAt: "2026-03-31T17:00:00Z", reviewedAt: "2026-04-03T10:00:00Z",
  },

  // ═══════════════════════════════════════════════════════════════════
  // Ana Reyes (EMP005) — DevOps Engineer, IT/Platforms
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "ALC-2026-1040",
    employeeId: "EMP005", employeeName: "Ana Reyes", employeeEmail: "ana@cpi.com.ph",
    team: "IT/Platforms", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "April", year: "2026", monthIndex: 3,
    streams: seedStreams([
      { category: "IT", activities: [
        { workType: "DevOps",         client: "Internal", description: "Kubernetes cluster upgrade and hardening", percentage: 25 },
        { workType: "Infrastructure", client: "Internal", description: "AWS cost optimization and right-sizing",   percentage: 15 },
        { workType: "Monitoring",     client: "Internal", description: "Datadog dashboard and alerting setup",    percentage: 10 },
      ]},
      { category: "Projects", activities: [
        { workType: "Implementation", client: "AUII",   description: "@AUII #Geniisys CI/CD pipeline for Quick Policy", percentage: 30, subCategory: "Geniisys" },
        { workType: "Maintenance",   client: "PNBGEN", description: "@PNBGEN #Geniisys deployment pipeline maintenance",  percentage: 10, subCategory: "Geniisys" },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings", client: "Internal", description: "DevOps guild and cross-team standups", percentage: 10 },
      ]},
    ]),
    status: "Pending Review", submittedAt: "2026-04-16T14:00:00Z",
  },

  // ═══════════════════════════════════════════════════════════════════
  // Rico Mendoza (EMP006) — Geniisys Developer, Ancillary Solutions
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "ALC-2026-1050",
    employeeId: "EMP006", employeeName: "Rico Mendoza", employeeEmail: "rico@cpi.com.ph",
    team: "Ancillary Solutions", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "March", year: "2026", monthIndex: 2,
    streams: seedStreams([
      { category: "Projects", activities: [
        { workType: "Implementation",    client: "AUII",   description: "@AUII #Geniisys claims processing module development", percentage: 40, subCategory: "Geniisys" },
        { workType: "Enhancement",      client: "AUII",   description: "@AUII #Geniisys document management enhancements",     percentage: 20, subCategory: "Geniisys" },
        { workType: "Product Development", client: "CPAIC", description: "@CPAIC #Geniisys Quick Policy product build",        percentage: 25, subCategory: "Geniisys" },
        { workType: "Testing",           client: "CPAIC", description: "@CPAIC #Geniisys Quick Policy QA testing",            percentage: 10, subCategory: "Geniisys" },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings", client: "Internal", description: "Sprint planning and retrospectives", percentage: 5 },
      ]},
    ]),
    status: "Approved", submittedAt: "2026-03-31T16:00:00Z", reviewedAt: "2026-04-04T09:00:00Z",
  },

  {
    id: "ALC-2026-1051",
    employeeId: "EMP006", employeeName: "Rico Mendoza", employeeEmail: "rico@cpi.com.ph",
    team: "Ancillary Solutions", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "April", year: "2026", monthIndex: 3,
    streams: seedStreams([
      { category: "Projects", activities: [
        { workType: "Implementation",    client: "AUII",   description: "@AUII #Geniisys SR-2345 policy rules implementation", percentage: 35, subCategory: "Geniisys" },
        { workType: "Enhancement",      client: "AUII",   description: "@AUII #Geniisys workflow automation enhancements",     percentage: 15, subCategory: "Geniisys" },
        { workType: "Product Development", client: "PNBGEN", description: "@PNBGEN #Quick Policy Quick Policy core engine",          percentage: 30, subCategory: "Quick Policy" },
        { workType: "Testing",           client: "PNBGEN", description: "@PNBGEN #Quick Policy Quick Policy UAT",                    percentage: 10, subCategory: "Quick Policy" },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings",      client: "Internal", description: "Architecture reviews and standups",      percentage: 5 },
        { workType: "Documentation", client: "Internal", description: "Technical specs for Quick Policy module", percentage: 5 },
      ]},
    ]),
    status: "Pending Review", submittedAt: "2026-04-15T15:00:00Z",
  },

  // ═══════════════════════════════════════════════════════════════════
  // Paolo Cruz (EMP007) — Geniisys QA Engineer, Ancillary Solutions
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "ALC-2026-1060",
    employeeId: "EMP007", employeeName: "Paolo Cruz", employeeEmail: "paolo@cpi.com.ph",
    team: "Ancillary Solutions", managerId: "HEAD001", managerName: "Roberto Cruz",
    month: "April", year: "2026", monthIndex: 3,
    streams: seedStreams([
      { category: "Projects", activities: [
        { workType: "Testing",        client: "AUII",   description: "@AUII #Geniisys regression suite and smoke tests",       percentage: 35, subCategory: "Geniisys" },
        { workType: "Testing",        client: "CPAIC",  description: "@CPAIC #Geniisys Quick Policy UAT and defect triage",    percentage: 30, subCategory: "Geniisys" },
        { workType: "Testing",        client: "PNBGEN", description: "@PNBGEN #Quick Policy Quick Policy integration test execution", percentage: 20, subCategory: "Quick Policy" },
        { workType: "Documentation",  client: "Internal", description: "#Geniisys QA test plan and traceability matrix",       percentage: 10, subCategory: "Geniisys" },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings", client: "Internal", description: "QA guild sync and sprint ceremonies", percentage: 5 },
      ]},
    ]),
    status: "Pending Review", submittedAt: "2026-04-16T16:00:00Z",
  },

  // ═══════════════════════════════════════════════════════════════════
  // Carlos Reyes (MGR001 / HEAD001) — IT Director personal allocations
  // Logged as HEAD001 for Team Hub "manager own data" test
  // ═══════════════════════════════════════════════════════════════════

  {
    id: "ALC-2026-2001",
    employeeId: "HEAD001", employeeName: "Roberto Cruz", employeeEmail: "head@cpi.com.ph",
    team: "IT/Platforms", managerId: null, managerName: "CEO",
    month: "March", year: "2026", monthIndex: 2,
    streams: seedStreams([
      { category: "Projects", activities: [
        { workType: "Planning",       client: "AUII",   description: "@AUII #Geniisys high-level architecture review and sign-off", percentage: 30, subCategory: "Geniisys" },
        { workType: "Meetings",       client: "AUII",   description: "@AUII #Geniisys Quick Policy executive alignment",            percentage: 15, subCategory: "Geniisys" },
        { workType: "Planning",       client: "CPAIC",  description: "@CPAIC #Quick Policy Quick Policy program planning",                 percentage: 20, subCategory: "Quick Policy" },
      ]},
      { category: "IT", activities: [
        { workType: "Security",       client: "Internal", description: "Quarterly IT governance and risk review", percentage: 15 },
        { workType: "Infrastructure", client: "Internal", description: "IT roadmap planning and vendor evaluation", percentage: 10 },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings",       client: "Internal", description: "Leadership meetings, 1:1s, team reviews", percentage: 10 },
      ]},
    ]),
    status: "Approved", submittedAt: "2026-03-31T18:00:00Z", reviewedAt: "2026-04-01T09:00:00Z",
  },

  {
    id: "ALC-2026-2002",
    employeeId: "HEAD001", employeeName: "Roberto Cruz", employeeEmail: "head@cpi.com.ph",
    team: "IT/Platforms", managerId: null, managerName: "CEO",
    month: "April", year: "2026", monthIndex: 3,
    streams: seedStreams([
      { category: "Projects", activities: [
        { workType: "Planning",  client: "AUII",   description: "@AUII #Geniisys architecture code review and technical guidance", percentage: 25, subCategory: "Geniisys" },
        { workType: "Meetings",  client: "AUII",   description: "@AUII #Geniisys Quick Policy client steering committee",          percentage: 15, subCategory: "Geniisys" },
        { workType: "Planning",  client: "PNBGEN", description: "@PNBGEN #Quick Policy Quick Policy scope review",                       percentage: 15, subCategory: "Quick Policy" },
      ]},
      { category: "IT", activities: [
        { workType: "Security",  client: "Internal", description: "IT security governance — board update prep", percentage: 15 },
        { workType: "DevOps",    client: "Internal", description: "Platform strategy review with engineering leads", percentage: 10 },
      ]},
      { category: "General Work", activities: [
        { workType: "Meetings",       client: "Internal", description: "Leadership calls, 1:1s with direct reports", percentage: 12 },
        { workType: "Administrative", client: "Internal", description: "Department budget review and resource planning", percentage: 8 },
      ]},
    ]),
    status: "Draft",
  },

];

const LocalAllocationsProvider = ({ children }: { children: ReactNode }) => {
  // Lazy init: hydrate from storage if available, otherwise seed.
  // Runs once on mount. JSON round-trip is safe for AllocationRecord
  // (no Date objects, no circular refs; flags map preserves keys).
  const [records, setRecords] = useState<AllocationRecord[]>(() => {
    const stored = getDataClient().read<AllocationRecord[]>("allocations");
    return stored ?? seedRecords;
  });

  // Persist on every records change. All six mutation methods on this
  // context (upsertDraft, submitForReview, approve, returnForRevision,
  // flagActivity, unflagActivity) call setRecords, so a single effect
  // on records catches them all.
  useEffect(() => {
    getDataClient().write("allocations", records);
  }, [records]);

  const getRecord = useCallback(
    (employeeId: string, month: string, year: string) =>
      records.find(
        (r) => r.employeeId === employeeId && r.month === month && r.year === year,
      ),
    [records],
  );

  const upsertDraft = useCallback<AllocationsContextType["upsertDraft"]>(
    (rec) => {
      setRecords((prev) => {
        const idx = prev.findIndex(
          (r) =>
            r.employeeId === rec.employeeId &&
            r.month === rec.month &&
            r.year === rec.year,
        );
        if (idx >= 0) {
          const existing = prev[idx];
          if (
            existing.status === "Pending Review" ||
            existing.status === "Approved"
          )
            return prev;

          // Idempotence guard: if the caller's payload describes the
          // same streams and status we already have, return prev
          // unchanged. This keeps the records-array reference stable,
          // which matters because some consumers (MonthlyAllocations)
          // key derivations off existingRecord identity; reference
          // bumps on no-op writes triggered an infinite effect loop
          // when a record loaded via deep link (Phase K fix).
          const nextStatus = rec.status ?? existing.status;
          if (
            nextStatus === existing.status &&
            JSON.stringify(existing.streams) === JSON.stringify(rec.streams)
          ) {
            return prev;
          }

          const updated = [...prev];
          updated[idx] = {
            ...existing,
            streams: rec.streams,
            status: nextStatus,
          };
          return updated;
        }
        return [...prev, { ...rec, status: rec.status ?? "Draft" }];
      });
    },
    [],
  );

  const submitForReview = useCallback<AllocationsContextType["submitForReview"]>(
    async (employeeId, month, year, streams) => {
      let trackingId = "";
      setRecords((prev) =>
        prev.map((r) => {
          if (r.employeeId === employeeId && r.month === month && r.year === year) {
            trackingId = r.id;
            return {
              ...r,
              // If the caller passed final streams, commit them with the
              // status flip so a "submitted" record can never appear with
              // stale or empty cards on reload.
              streams: streams ?? r.streams,
              status: "Pending Review" as AllocationStatus,
              submittedAt: new Date().toISOString(),
              feedback: undefined,
              flags: undefined,
            };
          }
          return r;
        }),
      );
      return trackingId;
    },
    [],
  );

  const approve = useCallback(async (recordId: string) => {
    setRecords((prev) => {
      const record = prev.find((r) => r.id === recordId);
      if (record?.flags && Object.keys(record.flags).length > 0) {
        throw new Error("approve: clear all flags before approving");
      }
      return prev.map((r) =>
        r.id === recordId
          ? {
              ...r,
              status: "Approved" as AllocationStatus,
              reviewedAt: new Date().toISOString(),
            }
          : r,
      );
    });
  }, []);

  const returnForRevision = useCallback(
    async (recordId: string, feedback?: string) => {
      setRecords((prev) => {
        const record = prev.find((r) => r.id === recordId);
        if (record && (!record.flags || Object.keys(record.flags).length === 0)) {
          throw new Error(
            "returnForRevision: at least one activity must be flagged before returning for revision",
          );
        }
        return prev.map((r) =>
          r.id === recordId
            ? {
                ...r,
                status: "Needs Revision" as AllocationStatus,
                feedback,
                reviewedAt: new Date().toISOString(),
              }
            : r,
        );
      });
    },
    [],
  );

  const getRecordsForManager = useCallback(
    (managerId: string, _team?: string) => {
      // Match purely on managerId. A manager may have reports across
      // multiple teams (e.g. an IT Director with reports in both
      // "IT/Platforms" and "Ancillary Solutions"); the manager's own
      // `team` field must NOT exclude those records. The `team`
      // parameter is kept for signature compatibility but ignored.
      const matched = records.filter((r) => r.managerId === managerId);

      // Dev-only leak audit: confirms no record returned has a
      // mismatched managerId. Catches the class of bug that Phase H
      // is designed to prevent (silent cross-manager data leaks).
      if (process.env.NODE_ENV !== "production") {
        for (const r of matched) {
          if (r.managerId !== managerId) {
            // eslint-disable-next-line no-console
            console.error(
              `[AllocationsContext] getRecordsForManager leak: record ${r.id} ` +
              `has managerId="${r.managerId}" but was returned for query "${managerId}".`,
            );
          }
        }
      }

      return matched;
    },
    [records],
  );

  const getApprovedForEmployee = useCallback(
    (
      employeeId: string,
      fromMonthIdx: number,
      fromYear: number,
      toMonthIdx: number,
      toYear: number,
    ) => {
      const fromKey = fromYear * 12 + fromMonthIdx;
      const toKey = toYear * 12 + toMonthIdx;
      return records.filter((r) => {
        if (r.employeeId !== employeeId || r.status !== "Approved") return false;
        const k = parseInt(r.year, 10) * 12 + r.monthIndex;
        return k >= fromKey && k <= toKey;
      });
    },
    [records],
  );

  const getHistoryForEmployee = useCallback(
    (employeeId: string) =>
      records
        .filter((r) => r.employeeId === employeeId)
        .sort((a, b) => {
          const ka = parseInt(a.year, 10) * 12 + a.monthIndex;
          const kb = parseInt(b.year, 10) * 12 + b.monthIndex;
          return ka - kb;
        }),
    [records],
  );

  const flagActivity = useCallback(
    (recordId: string, activityId: string, reason: string) => {
      setRecords((prev) =>
        prev.map((r) => {
          if (r.id !== recordId) return r;
          if (r.status !== "Pending Review") {
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.warn(
                `[AllocationsContext] flagActivity ignored: record ${recordId} is "${r.status}", not "Pending Review"`,
              );
            }
            return r;
          }
          const activityExists = r.streams.some((s) =>
            s.activities.some((a) => a.id === activityId),
          );
          if (!activityExists) {
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.warn(
                `[AllocationsContext] flagActivity ignored: activity ${activityId} not found on record ${recordId}`,
              );
            }
            return r;
          }
          return {
            ...r,
            flags: {
              ...(r.flags ?? {}),
              [activityId]: { reason, flaggedAt: new Date().toISOString() },
            },
          };
        }),
      );
    },
    [],
  );

  const unflagActivity = useCallback(
    (recordId: string, activityId: string) => {
      setRecords((prev) =>
        prev.map((r) => {
          if (r.id !== recordId || !r.flags || !(activityId in r.flags)) return r;
          const nextFlags = { ...r.flags };
          delete nextFlags[activityId];
          return {
            ...r,
            flags: Object.keys(nextFlags).length > 0 ? nextFlags : undefined,
          };
        }),
      );
    },
    [],
  );

  const managerEdit = useCallback<AllocationsContextType["managerEdit"]>(
    (recordId, streams, editor, options) => {
      setRecords((prev) =>
        prev.map((r) => {
          if (r.id !== recordId) return r;

          // Approved is terminal — refuse edits.
          if (r.status === "Approved") {
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.warn(
                `[AllocationsContext] managerEdit refused: record ${recordId} is Approved (terminal).`,
              );
            }
            return r;
          }

          // Only the assigned manager can edit. Defense-in-depth —
          // the UI already scopes via getRecordsForManager, but the
          // context enforces it too.
          if (r.managerId !== editor.userId) {
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.error(
                `[AllocationsContext] managerEdit rejected: editor "${editor.userId}" ` +
                `is not the assigned manager "${r.managerId}" for record ${recordId}.`,
              );
            }
            return r;
          }

          return {
            ...r,
            streams,
            lastEditedBy: {
              userId: editor.userId,
              userName: editor.userName,
              at: new Date().toISOString(),
            },
            // Clear flags by default — the edit is the fix. Keep
            // them only when the caller explicitly opts in.
            flags: options?.keepFlags ? r.flags : undefined,
          };
        }),
      );
    },
    [],
  );

  /**
   * Rename a team across every allocation record. Only touches the
   * top-level `team` field; the nested activities don't carry a
   * team, so no deeper traversal needed.
   */
  const renameTeam = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName) return;
      setRecords((prev) =>
        prev.map((r) => (r.team === oldName ? { ...r, team: newName } : r)),
      );
    },
    [],
  );

  /**
   * Rename a client across every activity in every stream of every
   * record. This is a deep traversal but the records list is small
   * (< 100 at demo scale) and the operation is atomic.
   */
  const renameClient = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName) return;
      setRecords((prev) =>
        prev.map((r) => ({
          ...r,
          streams: r.streams.map((s) => ({
            ...s,
            activities: s.activities.map((a) =>
              a.client === oldName ? { ...a, client: newName } : a,
            ),
          })),
        })),
      );
    },
    [],
  );

  return (
    <AllocationsContext.Provider
      value={{
        records,
        // Local mode seeds synchronously on mount, so records are always
        // authoritative from the first render.
        isLoaded: true,
        getRecord,
        upsertDraft,
        submitForReview,
        approve,
        returnForRevision,
        getRecordsForManager,
        getApprovedForEmployee,
        getHistoryForEmployee,
        flagActivity,
        unflagActivity,
        managerEdit,
        renameTeam,
        renameClient,
      }}
    >
      {children}
    </AllocationsContext.Provider>
  );
};

export { months as MONTH_NAMES };

// ── Helpers: wire API status strings to the local union ──────────────────────

const STATUS_MAP: Record<string, AllocationStatus> = {
  Draft:          "Draft",
  PendingReview:  "Pending Review",
  Approved:       "Approved",
  NeedsRevision:  "Needs Revision",
};

// Domain (spaced) → wire (enum) status. Inverse of STATUS_MAP; used to send
// the optimistic-concurrency `expectedStatus` token back to the API on
// approve/return so the backend can detect a peer racing the same record.
type WireStatus = "Draft" | "PendingReview" | "Approved" | "NeedsRevision";
const TO_WIRE_STATUS: Record<AllocationStatus, WireStatus> = {
  Draft:             "Draft",
  "Pending Review":  "PendingReview",
  Approved:          "Approved",
  "Needs Revision":  "NeedsRevision",
};

// Exported so the Peer Coverage hooks can reuse the exact same wire→domain
// mapping when they fetch a peer manager's submissions directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromApiRecord(r: any): AllocationRecord {
  return {
    id:            r.id,
    employeeId:    r.employeeId,
    employeeName:  r.employeeName,
    employeeEmail: r.employeeEmail,
    team:          r.team,
    managerId:     r.managerId ?? "",
    managerName:   r.managerName ?? "",
    month:         r.month,
    year:          r.year,
    monthIndex:    r.monthIndex,
    streams:       r.streams as WorkStreamData[],
    status:        STATUS_MAP[r.status] ?? "Draft",
    ...(r.submittedAt && { submittedAt: r.submittedAt }),
    ...(r.reviewedAt  && { reviewedAt:  r.reviewedAt }),
    ...(r.feedback    != null && { feedback: r.feedback }),
    ...(r.flags && Object.keys(r.flags).length > 0 && { flags: r.flags }),
    ...(r.lastEditedBy && { lastEditedBy: r.lastEditedBy }),
    ...(r.actionedBy && { actionedBy: r.actionedBy }),
  };
}

// ── API-backed provider ───────────────────────────────────────────────────────

const ApiAllocationsProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const { currentUser } = useAuth();

  const { data: apiRecords = [], isSuccess } = useQuery({
    queryKey: ["allocations"],
    queryFn: ({ signal }) => api.allocations.list(undefined, signal),
    enabled: !!currentUser,
    staleTime: 30_000,
  });

  const records: AllocationRecord[] = apiRecords.map(fromApiRecord);

  // Records are authoritative only after the first fetch has resolved.
  // Until then `records` is an empty placeholder, which the reminder
  // scheduler must not read as "this user has no allocation".
  const isLoaded = isSuccess;

  const inv = useCallback(
    () => qc.invalidateQueries({ queryKey: ["allocations"] }),
    [qc],
  );

  const upsertMut = useMutation({
    mutationFn: (body: Parameters<typeof api.allocations.upsertDraft>[0]) =>
      api.allocations.upsertDraft(body),
    onSuccess: inv,
  });

  const submitMut = useMutation({
    mutationFn: ({ id, streams }: { id: string; streams?: WorkStreamData[] }) =>
      api.allocations.submit(
        id,
        streams as Parameters<typeof api.allocations.submit>[1],
      ),
    onSuccess: inv,
  });

  const approveMut = useMutation({
    mutationFn: ({ id, expectedStatus }: { id: string; expectedStatus?: WireStatus }) =>
      api.allocations.approve(id, expectedStatus),
    // onSettled (not just onSuccess): a 409 conflict means someone else moved
    // the record, so we must refetch to show its real current state too.
    onSettled: inv,
  });

  const returnMut = useMutation({
    mutationFn: ({
      id,
      feedback,
      expectedStatus,
    }: {
      id: string;
      feedback?: string;
      expectedStatus?: WireStatus;
    }) => api.allocations.returnForRevision(id, feedback, expectedStatus),
    onSettled: inv,
  });

  const flagMut = useMutation({
    mutationFn: ({ id, activityId, reason }: { id: string; activityId: string; reason: string }) =>
      api.allocations.flagActivity(id, activityId, reason),
    onSuccess: inv,
  });

  const unflagMut = useMutation({
    mutationFn: ({ id, activityId }: { id: string; activityId: string }) =>
      api.allocations.unflagActivity(id, activityId),
    onSuccess: inv,
  });

  const managerEditMut = useMutation({
    mutationFn: ({ id, streams }: { id: string; streams: WorkStreamData[] }) =>
      api.allocations.managerEdit(id, streams as Parameters<typeof api.allocations.managerEdit>[1]),
    onSuccess: inv,
  });

  const getRecord = useCallback(
    (employeeId: string, month: string, year: string) =>
      records.find(
        (r) => r.employeeId === employeeId && r.month === month && r.year === year,
      ),
    [records],
  );

  const upsertDraft = useCallback<AllocationsContextType["upsertDraft"]>(
    (rec) => {
      upsertMut.mutate({
        id: rec.id,
        employeeId: rec.employeeId,
        team: rec.team,
        managerId: rec.managerId || null,
        month: rec.month,
        year: rec.year,
        monthIndex: rec.monthIndex,
        streams: rec.streams as Parameters<typeof api.allocations.upsertDraft>[0]["streams"],
      });
    },
    [upsertMut],
  );

  const submitForReview = useCallback<AllocationsContextType["submitForReview"]>(
    async (employeeId, month, year, streams) => {
      // Two-phase to close the autosave-vs-submit race:
      //
      //   1. If the record is already in the cache, use its id directly.
      //   2. Otherwise (latest autosave hasn't round-tripped yet, or no
      //      autosave ever happened), upsert FIRST with the in-memory
      //      streams and use the returned record's id. Awaiting here is
      //      what guarantees the record exists in the DB before submit
      //      runs — without this, submit silently no-ops and the user
      //      sees a "Pending Review" toast but reloads to empty Draft.
      let recordId = records.find(
        (r) =>
          r.employeeId === employeeId &&
          r.month === month &&
          r.year === year,
      )?.id;

      if (!recordId) {
        if (!streams || !currentUser) return "";
        const created = await upsertMut.mutateAsync({
          employeeId,
          team: currentUser.team,
          managerId: currentUser.managerId ?? null,
          month,
          year,
          monthIndex: months.indexOf(month),
          streams: streams as Parameters<
            typeof api.allocations.upsertDraft
          >[0]["streams"],
        });
        recordId = created.id;
      }

      // Pass streams atomically to ensure the final card state lands in
      // the same transaction as the status flip on the backend.
      await submitMut.mutateAsync({ id: recordId, streams });
      return recordId;
    },
    [records, submitMut, upsertMut, currentUser],
  );

  const approve = useCallback(
    async (recordId: string) => {
      // Snapshot the status the reviewer is acting on so the backend can
      // detect a peer racing the same record. mutateAsync so a 409 rejects
      // out to the caller (TeamHub) for a specific error toast.
      const current = records.find((r) => r.id === recordId)?.status;
      await approveMut.mutateAsync({
        id: recordId,
        expectedStatus: current ? TO_WIRE_STATUS[current] : undefined,
      });
    },
    [approveMut, records],
  );

  const returnForRevision = useCallback(
    async (recordId: string, feedback?: string) => {
      const current = records.find((r) => r.id === recordId)?.status;
      await returnMut.mutateAsync({
        id: recordId,
        feedback,
        expectedStatus: current ? TO_WIRE_STATUS[current] : undefined,
      });
    },
    [returnMut, records],
  );

  const getRecordsForManager = useCallback(
    (managerId: string, _team?: string) =>
      // A manager may have reports across multiple teams; their own
      // `team` must NOT filter out cross-team reports. Match on
      // managerId only. The `team` parameter is kept for signature
      // compatibility but ignored.
      records.filter((r) => r.managerId === managerId),
    [records],
  );

  const getApprovedForEmployee = useCallback(
    (
      employeeId: string,
      fromMonthIdx: number,
      fromYear: number,
      toMonthIdx: number,
      toYear: number,
    ) => {
      const fromKey = fromYear * 12 + fromMonthIdx;
      const toKey   = toYear  * 12 + toMonthIdx;
      return records.filter((r) => {
        if (r.employeeId !== employeeId || r.status !== "Approved") return false;
        const k = parseInt(r.year, 10) * 12 + r.monthIndex;
        return k >= fromKey && k <= toKey;
      });
    },
    [records],
  );

  const getHistoryForEmployee = useCallback(
    (employeeId: string) =>
      records
        .filter((r) => r.employeeId === employeeId)
        .sort((a, b) => {
          const ka = parseInt(a.year, 10) * 12 + a.monthIndex;
          const kb = parseInt(b.year, 10) * 12 + b.monthIndex;
          return ka - kb;
        }),
    [records],
  );

  const flagActivity = useCallback(
    (recordId: string, activityId: string, reason: string) => {
      flagMut.mutate({ id: recordId, activityId, reason });
    },
    [flagMut],
  );

  const unflagActivity = useCallback(
    (recordId: string, activityId: string) => {
      unflagMut.mutate({ id: recordId, activityId });
    },
    [unflagMut],
  );

  const managerEdit = useCallback<AllocationsContextType["managerEdit"]>(
    (recordId, streams, _editor, _options) => {
      managerEditMut.mutate({ id: recordId, streams });
    },
    [managerEditMut],
  );

  // Team/client rename in API mode is server-side; no-op on the client
  const renameTeam   = useCallback(() => {}, []);
  const renameClient = useCallback(() => {}, []);

  return (
    <AllocationsContext.Provider
      value={{
        records,
        isLoaded,
        getRecord,
        upsertDraft,
        submitForReview,
        approve,
        returnForRevision,
        getRecordsForManager,
        getApprovedForEmployee,
        getHistoryForEmployee,
        flagActivity,
        unflagActivity,
        managerEdit,
        renameTeam,
        renameClient,
      }}
    >
      {children}
    </AllocationsContext.Provider>
  );
};

// ── Public export — dispatches based on VITE_USE_API ─────────────────────────

export const AllocationsProvider = ({ children }: { children: ReactNode }) => {
  const isApiMode = import.meta.env.VITE_USE_API === "true";
  if (isApiMode) return <ApiAllocationsProvider>{children}</ApiAllocationsProvider>;
  return <LocalAllocationsProvider>{children}</LocalAllocationsProvider>;
};
