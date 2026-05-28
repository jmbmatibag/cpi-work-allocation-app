import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDataClient } from "@/lib/dataClient";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import type { TimeBlock } from "@/lib/journalAggregation";

export type { TimeBlock };

export interface JournalEntry {
  employeeId: string;
  date: string; // YYYY-MM-DD
  content: string;
  blocks?: TimeBlock[];
  updatedAt: string;
}

interface JournalContextType {
  entries: JournalEntry[];
  getEntry: (employeeId: string, date: string) => JournalEntry | undefined;
  saveEntry: (employeeId: string, date: string, content: string, blocks?: TimeBlock[]) => void;
  getEntriesForMonth: (employeeId: string, year: number, month: number) => JournalEntry[];
  getDatesWithEntries: (employeeId: string) => Set<string>;
  /**
   * Rewrite `@oldClient` tokens to `@newClient` across every journal
   * entry's content. Called by Admin Settings after a client rename
   * in ClientsConfig so the `@CLIENT` tags that the prompt parser
   * relies on stay round-trippable.
   *
   * Uses a word-boundary match so `@AUII` is rewritten but not
   * `@AUIIX`. Case-sensitive because client codes are uppercase and
   * a case-insensitive replace could accidentally rewrite unrelated
   * tokens in free-text descriptions.
   */
  renameClientTag: (oldName: string, newName: string) => void;
}

const JournalContext = createContext<JournalContextType>({
  entries: [],
  getEntry: () => undefined,
  saveEntry: () => {},
  getEntriesForMonth: () => [],
  getDatesWithEntries: () => new Set(),
  renameClientTag: () => {},
});

export const useJournal = () => useContext(JournalContext);

/**
 * Seed data for testing. Three employees (EMP001 Jose, EMP004 Carlos
 * Garcia, EMP011 Kim) across Feb 1 – Apr 20 2026, weekdays only.
 *
 * Density mix per employee:
 *   ~60% tagged multi-line entries (@client + #category)
 *   ~25% natural-language single lines (exercises parser fallbacks)
 *   ~10% sparse single lines ("Out for training", "PTO")
 *    ~5% missed days (no entry at all)
 *
 * Generated deterministically from a seeded PRNG — see
 * /home/claude/mockgen/gen.mjs in the refactor notes.
 */
const SEED_ENTRIES: JournalEntry[] = [
  { employeeId: "EMP001", date: "2026-02-02", content: "Pair-programmed with Ana on the PNBGEN endpoint. Shipped the fix.", updatedAt: "2026-02-02T08:19:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-03", content: "- 1:1 with @AUII tech lead #General\n- @PNBGEN claims module endpoint work #Projects\n- Architecture review meeting #Projects\n- @UCPB code review for claims processing #Projects\n- @AUII security audit kickoff #IT", updatedAt: "2026-02-03T15:30:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-04", content: "- @PNBGEN API integration sprint #Projects\n- @AUII RDS migration dry run #IT\n- @PNBGEN bug triage for integration layer #Projects\n- @AUII AWS migration planning #IT\n- Sprint planning #Projects", updatedAt: "2026-02-04T16:13:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-05", content: "- @AUII AWS migration planning #IT\n- @PNBGEN bug triage for integration layer #Projects\n- @AUII VPC peering setup #IT\n- @UCPB code review for claims processing #Projects\n- @AUII Kubernetes deployment #IT", updatedAt: "2026-02-05T12:22:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-06", content: "Out for training.", updatedAt: "2026-02-06T11:26:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-09", content: "- @AUII CI/CD pipeline tuning #IT\n- @AUII Kubernetes deployment #IT\n- @AUII S3 bucket policy audit #IT\n- @PNBGEN API integration sprint #Projects\n- @UCPB code review for claims processing #Projects", updatedAt: "2026-02-09T17:22:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-10", content: "Sprint planning in the morning, then Kubernetes manifest cleanup.", updatedAt: "2026-02-10T16:40:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-11", content: "- Team standup #General\n- @UCPB code review for claims processing #Projects\n- @AUII S3 bucket policy audit #IT\n- @AUII AWS migration planning #IT", updatedAt: "2026-02-11T14:22:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-12", content: "Sprint planning in the morning, then Kubernetes manifest cleanup.", updatedAt: "2026-02-12T15:23:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-13", content: "- @PNBGEN bug triage for integration layer #Projects\n- @AUII ECS cluster provisioning #IT\n- Team standup #General\n- Sprint retrospective #Projects\n- @AUII AWS migration planning #IT", updatedAt: "2026-02-13T16:41:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-16", content: "Deep work on the ECS cluster config. No meetings today.", updatedAt: "2026-02-16T17:06:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-17", content: "- Team standup #General\n- @AUII CI/CD pipeline tuning #IT\n- Architecture review meeting #Projects\n- @UCPB code review for claims processing #Projects\n- @PNBGEN bug triage for integration layer #Projects", updatedAt: "2026-02-17T11:52:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-18", content: "Light day. Backlog grooming only.", updatedAt: "2026-02-18T12:02:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-19", content: "- @AUII AWS migration planning #IT\n- @AUII S3 bucket policy audit #IT\n- @AUII VPC peering setup #IT", updatedAt: "2026-02-19T16:47:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-20", content: "- @PNBGEN API integration sprint #Projects\n- Sprint planning #Projects\n- @PNBGEN bug triage for integration layer #Projects\n- 1:1 with @AUII tech lead #General", updatedAt: "2026-02-20T12:36:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-23", content: "Pair-programmed with Ana on the PNBGEN endpoint. Shipped the fix.", updatedAt: "2026-02-23T08:38:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-24", content: "- @AUII security audit kickoff #IT\n- 1:1 with @AUII tech lead #General\n- @AUII ECS cluster provisioning #IT\n- @PNBGEN API integration sprint #Projects\n- @AUII CI/CD pipeline tuning #IT", updatedAt: "2026-02-24T13:54:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-25", content: "- Sprint planning #Projects\n- Team standup #General\n- @AUII CI/CD pipeline tuning #IT", updatedAt: "2026-02-25T16:06:00.000Z" },
  { employeeId: "EMP001", date: "2026-02-26", content: "Security audit prep for AUII. Pulled together the inventory docs.", updatedAt: "2026-02-26T16:46:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-02", content: "Half-day — doctor's appointment.", updatedAt: "2026-03-02T13:24:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-03", content: "Fought with Terraform state for most of the day. Finally got AUII's VPC peering working.", updatedAt: "2026-03-03T09:01:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-04", content: "Half-day — doctor's appointment.", updatedAt: "2026-03-04T13:26:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-05", content: "- 1:1 with @AUII tech lead #General\n- @AUII AWS migration planning #IT\n- @AUII CI/CD pipeline tuning #IT\n- @PNBGEN bug triage for integration layer #Projects\n- @AUII VPC peering setup #IT", updatedAt: "2026-03-05T15:53:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-06", content: "- @AUII S3 bucket policy audit #IT\n- @PNBGEN claims module endpoint work #Projects\n- @AUII Kubernetes deployment #IT\n- Sprint planning #Projects", updatedAt: "2026-03-06T16:26:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-09", content: "- Architecture review meeting #Projects\n- @UCPB code review for claims processing #Projects\n- @AUII RDS migration dry run #IT", updatedAt: "2026-03-09T15:23:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-10", content: "- @AUII ECS cluster provisioning #IT\n- @AUII CI/CD pipeline tuning #IT\n- @PNBGEN bug triage for integration layer #Projects\n- Sprint retrospective #Projects", updatedAt: "2026-03-10T12:52:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-11", content: "- Team standup #General\n- Sprint planning #Projects\n- Sprint retrospective #Projects\n- @AUII S3 bucket policy audit #IT", updatedAt: "2026-03-11T15:44:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-12", content: "- Team standup #General\n- @AUII Kubernetes deployment #IT\n- @AUII security audit kickoff #IT", updatedAt: "2026-03-12T15:14:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-13", content: "- @UCPB code review for claims processing #Projects\n- @AUII ECS cluster provisioning #IT\n- @PNBGEN bug triage for integration layer #Projects", updatedAt: "2026-03-13T15:52:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-16", content: "- @AUII ECS cluster provisioning #IT\n- Team standup #General\n- @AUII CI/CD pipeline tuning #IT\n- Sprint planning #Projects\n- @AUII VPC peering setup #IT", updatedAt: "2026-03-16T15:00:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-17", content: "- @AUII VPC peering setup #IT\n- @AUII RDS migration dry run #IT\n- Sprint retrospective #Projects\n- @PNBGEN claims module endpoint work #Projects", updatedAt: "2026-03-17T10:42:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-18", content: "Spent the morning on AWS migration scoping. Afternoon was integration testing for PNBGEN.", updatedAt: "2026-03-18T08:02:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-19", content: "Public holiday.", updatedAt: "2026-03-19T12:34:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-20", content: "Pair-programmed with Ana on the PNBGEN endpoint. Shipped the fix.", updatedAt: "2026-03-20T09:46:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-23", content: "Pair-programmed with Ana on the PNBGEN endpoint. Shipped the fix.", updatedAt: "2026-03-23T12:44:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-24", content: "Pair-programmed with Ana on the PNBGEN endpoint. Shipped the fix.", updatedAt: "2026-03-24T13:52:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-25", content: "- @PNBGEN bug triage for integration layer #Projects\n- @UCPB code review for claims processing #Projects\n- @AUII ECS cluster provisioning #IT\n- @AUII VPC peering setup #IT", updatedAt: "2026-03-25T13:52:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-26", content: "- 1:1 with @AUII tech lead #General\n- @AUII CI/CD pipeline tuning #IT\n- @PNBGEN API integration sprint #Projects", updatedAt: "2026-03-26T13:59:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-27", content: "Fought with Terraform state for most of the day. Finally got AUII's VPC peering working.", updatedAt: "2026-03-27T12:20:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-30", content: "Sprint planning in the morning, then Kubernetes manifest cleanup.", updatedAt: "2026-03-30T17:15:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-31", content: "Spent the morning on AWS migration scoping. Afternoon was integration testing for PNBGEN.", updatedAt: "2026-03-31T14:45:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-01", content: "Half-day — doctor's appointment.", updatedAt: "2026-04-01T08:03:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-02", content: "- Sprint retrospective #Projects\n- @PNBGEN API integration sprint #Projects\n- @AUII RDS migration dry run #IT\n- 1:1 with @AUII tech lead #General", updatedAt: "2026-04-02T15:42:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-03", content: "Out for training.", updatedAt: "2026-04-03T16:56:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-06", content: "- @PNBGEN bug triage for integration layer #Projects\n- Sprint retrospective #Projects\n- @AUII Kubernetes deployment #IT\n- @PNBGEN claims module endpoint work #Projects", updatedAt: "2026-04-06T12:39:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-07", content: "Spent the morning on AWS migration scoping. Afternoon was integration testing for PNBGEN.", updatedAt: "2026-04-07T15:43:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-08", content: "- @UCPB code review for claims processing #Projects\n- Sprint retrospective #Projects\n- @PNBGEN API integration sprint #Projects\n- @AUII security audit kickoff #IT\n- @AUII Kubernetes deployment #IT", updatedAt: "2026-04-08T09:40:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-09", content: "- 1:1 with @AUII tech lead #General\n- @AUII Kubernetes deployment #IT\n- @AUII S3 bucket policy audit #IT\n- Sprint retrospective #Projects\n- @PNBGEN bug triage for integration layer #Projects", updatedAt: "2026-04-09T09:31:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-10", content: "- @AUII ECS cluster provisioning #IT\n- @AUII CI/CD pipeline tuning #IT\n- @AUII security audit kickoff #IT\n- @PNBGEN API integration sprint #Projects", updatedAt: "2026-04-10T15:12:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-13", content: "- @AUII security audit kickoff #IT\n- @AUII S3 bucket policy audit #IT\n- Sprint retrospective #Projects\n- @PNBGEN bug triage for integration layer #Projects\n- @AUII ECS cluster provisioning #IT", updatedAt: "2026-04-13T15:46:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-14", content: "- @PNBGEN claims module endpoint work #Projects\n- @UCPB code review for claims processing #Projects\n- Architecture review meeting #Projects\n- @AUII RDS migration dry run #IT\n- Team standup #General", updatedAt: "2026-04-14T10:07:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-15", content: "Security audit prep for AUII. Pulled together the inventory docs.", updatedAt: "2026-04-15T14:43:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-16", content: "- Sprint planning #Projects\n- 1:1 with @AUII tech lead #General\n- @AUII security audit kickoff #IT\n- @PNBGEN bug triage for integration layer #Projects", updatedAt: "2026-04-16T13:57:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-17", content: "- Sprint retrospective #Projects\n- @AUII S3 bucket policy audit #IT\n- Sprint planning #Projects\n- @AUII VPC peering setup #IT\n- Architecture review meeting #Projects", updatedAt: "2026-04-17T17:16:00.000Z" },
  { employeeId: "EMP001", date: "2026-04-20", content: "- @PNBGEN claims module endpoint work #Projects\n- Architecture review meeting #Projects\n- @PNBGEN API integration sprint #Projects\n- @AUII CI/CD pipeline tuning #IT\n- @AUII AWS migration planning #IT", updatedAt: "2026-04-20T14:21:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-02", content: "- @UCPB IAM policy audit #IT\n- Incident response tabletop exercise #IT\n- Internal DNS hardening #IT", updatedAt: "2026-02-02T08:45:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-04", content: "- @CPAIC quarterly security review #IT\n- Security awareness training prep #HR\n- @UCPB access control matrix update #IT\n- Cross-team security sync #General\n- @AUII penetration test execution #IT", updatedAt: "2026-02-04T17:49:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-05", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-02-05T08:57:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-06", content: "- @PNBGEN security audit #IT\n- Security awareness training prep #HR\n- @AUII firewall rule review #IT", updatedAt: "2026-02-06T09:53:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-09", content: "- Cross-team security sync #General\n- @AUII penetration test execution #IT\n- @PNBGEN OWASP compliance review #IT", updatedAt: "2026-02-09T09:46:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-10", content: "- @PNBGEN security audit #IT\n- Cross-team security sync #General\n- @UCPB access control matrix update #IT\n- Security awareness training prep #HR\n- @AUII vulnerability scan report #IT", updatedAt: "2026-02-10T10:33:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-11", content: "- Security awareness training prep #HR\n- @UCPB IAM policy audit #IT\n- @AUII firewall rule review #IT\n- @CPAIC quarterly security review #IT\n- Incident response tabletop exercise #IT", updatedAt: "2026-02-11T08:43:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-13", content: "- Cross-team security sync #General\n- Incident response tabletop exercise #IT\n- @PNBGEN security audit #IT", updatedAt: "2026-02-13T17:18:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-16", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-02-16T09:37:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-17", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-02-17T09:31:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-18", content: "Firewall rule cleanup for the UCPB account. Decommissioned 40 stale rules.", updatedAt: "2026-02-18T15:21:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-19", content: "PTO.", updatedAt: "2026-02-19T13:28:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-20", content: "- @AUII firewall rule review #IT\n- @PNBGEN security audit #IT\n- Incident response tabletop exercise #IT\n- Internal DNS hardening #IT", updatedAt: "2026-02-20T15:40:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-23", content: "Writing up the vulnerability report for PNBGEN. Tedious but necessary.", updatedAt: "2026-02-23T11:56:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-24", content: "Full day on the AUII pentest. Found a SSRF in the admin panel.", updatedAt: "2026-02-24T08:53:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-25", content: "- Incident response tabletop exercise #IT\n- @UCPB IAM policy audit #IT\n- @PNBGEN security audit #IT\n- @CPAIC quarterly security review #IT", updatedAt: "2026-02-25T13:14:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-26", content: "- Cross-team security sync #General\n- Security awareness training prep #HR\n- @AUII firewall rule review #IT\n- @AUII penetration test execution #IT", updatedAt: "2026-02-26T08:36:00.000Z" },
  { employeeId: "EMP004", date: "2026-02-27", content: "Responded to a flagged login anomaly on the AUII tenant. False positive.", updatedAt: "2026-02-27T13:59:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-02", content: "- Cross-team security sync #General\n- @PNBGEN OWASP compliance review #IT\n- @AUII penetration test execution #IT\n- Incident response tabletop exercise #IT\n- SOC 2 evidence gathering #General", updatedAt: "2026-03-02T17:06:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-03", content: "- @AUII penetration test execution #IT\n- @UCPB IAM policy audit #IT\n- Internal DNS hardening #IT\n- @PNBGEN OWASP compliance review #IT", updatedAt: "2026-03-03T08:23:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-04", content: "Responded to a flagged login anomaly on the AUII tenant. False positive.", updatedAt: "2026-03-04T09:54:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-09", content: "- @AUII vulnerability scan report #IT\n- Cross-team security sync #General\n- SOC 2 evidence gathering #General", updatedAt: "2026-03-09T11:12:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-10", content: "- Internal DNS hardening #IT\n- Security awareness training prep #HR\n- @UCPB access control matrix update #IT\n- @AUII firewall rule review #IT", updatedAt: "2026-03-10T10:16:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-12", content: "- @AUII penetration test execution #IT\n- Cross-team security sync #General\n- @UCPB access control matrix update #IT\n- Security awareness training prep #HR", updatedAt: "2026-03-12T13:22:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-13", content: "Writing up the vulnerability report for PNBGEN. Tedious but necessary.", updatedAt: "2026-03-13T13:15:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-16", content: "Firewall rule cleanup for the UCPB account. Decommissioned 40 stale rules.", updatedAt: "2026-03-16T15:58:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-17", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-03-17T11:44:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-18", content: "- @UCPB access control matrix update #IT\n- Internal DNS hardening #IT\n- @AUII firewall rule review #IT\n- Security awareness training prep #HR\n- @PNBGEN OWASP compliance review #IT", updatedAt: "2026-03-18T13:57:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-19", content: "- Internal DNS hardening #IT\n- @CPAIC quarterly security review #IT\n- Incident response tabletop exercise #IT\n- @AUII penetration test execution #IT", updatedAt: "2026-03-19T12:14:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-20", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-03-20T13:12:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-23", content: "- @AUII penetration test execution #IT\n- Cross-team security sync #General\n- @AUII vulnerability scan report #IT\n- @PNBGEN security audit #IT\n- Internal DNS hardening #IT", updatedAt: "2026-03-23T13:31:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-25", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-03-25T12:02:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-26", content: "- @UCPB access control matrix update #IT\n- SOC 2 evidence gathering #General\n- @PNBGEN OWASP compliance review #IT\n- Security awareness training prep #HR", updatedAt: "2026-03-26T08:58:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-27", content: "- Cross-team security sync #General\n- @AUII penetration test execution #IT\n- @AUII vulnerability scan report #IT\n- @PNBGEN OWASP compliance review #IT\n- Internal DNS hardening #IT", updatedAt: "2026-03-27T11:02:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-30", content: "- @AUII penetration test execution #IT\n- @AUII vulnerability scan report #IT\n- Security awareness training prep #HR", updatedAt: "2026-03-30T14:13:00.000Z" },
  { employeeId: "EMP004", date: "2026-03-31", content: "Full day on the AUII pentest. Found a SSRF in the admin panel.", updatedAt: "2026-03-31T12:23:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-01", content: "Compliance documentation updates for the SOC 2 auditors.", updatedAt: "2026-04-01T15:56:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-02", content: "- Cross-team security sync #General\n- @AUII firewall rule review #IT\n- @AUII vulnerability scan report #IT\n- Internal DNS hardening #IT\n- @CPAIC quarterly security review #IT", updatedAt: "2026-04-02T10:13:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-03", content: "- @UCPB access control matrix update #IT\n- @PNBGEN OWASP compliance review #IT\n- Internal DNS hardening #IT\n- Incident response tabletop exercise #IT\n- Security awareness training prep #HR", updatedAt: "2026-04-03T14:19:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-06", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-04-06T17:20:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-07", content: "Responded to a flagged login anomaly on the AUII tenant. False positive.", updatedAt: "2026-04-07T14:01:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-08", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-04-08T13:28:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-09", content: "- Incident response tabletop exercise #IT\n- @AUII vulnerability scan report #IT\n- @CPAIC quarterly security review #IT\n- @AUII firewall rule review #IT\n- @PNBGEN OWASP compliance review #IT", updatedAt: "2026-04-09T15:22:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-10", content: "- @AUII firewall rule review #IT\n- @UCPB IAM policy audit #IT\n- Security awareness training prep #HR\n- @AUII vulnerability scan report #IT\n- SOC 2 evidence gathering #General", updatedAt: "2026-04-10T12:32:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-13", content: "Quarterly security review meetings. Four back to back.", updatedAt: "2026-04-13T16:21:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-14", content: "Out sick.", updatedAt: "2026-04-14T16:18:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-15", content: "Training — CISSP refresh course.", updatedAt: "2026-04-15T17:51:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-16", content: "- @PNBGEN security audit #IT\n- @AUII penetration test execution #IT\n- Cross-team security sync #General", updatedAt: "2026-04-16T16:00:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-17", content: "- Cross-team security sync #General\n- @UCPB IAM policy audit #IT\n- SOC 2 evidence gathering #General\n- @AUII penetration test execution #IT", updatedAt: "2026-04-17T13:15:00.000Z" },
  { employeeId: "EMP004", date: "2026-04-20", content: "Firewall rule cleanup for the UCPB account. Decommissioned 40 stale rules.", updatedAt: "2026-04-20T17:16:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-02", content: "- Printer fleet maintenance #IT\n- Network switch firmware upgrade #IT\n- Tier 2 tickets — VPN and M365 issues #IT\n- Backup system verification #IT\n- Weekly infra check-in #General", updatedAt: "2026-02-02T13:33:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-04", content: "- Weekly infra check-in #General\n- New hire laptop provisioning #IT\n- Onboarding new finance team member #HR\n- Backup system verification #IT", updatedAt: "2026-02-04T11:37:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-05", content: "Helpdesk queue was rough today. Escalations around M365 sync.", updatedAt: "2026-02-05T14:33:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-06", content: "WFH — light ticket triage only.", updatedAt: "2026-02-06T11:53:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-09", content: "- New hire laptop provisioning #IT\n- Printer fleet maintenance #IT\n- DNS configuration audit #IT\n- Office WiFi coverage survey #IT\n- Network switch firmware upgrade #IT", updatedAt: "2026-02-09T16:41:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-10", content: "- Cisco certification study #General\n- New hire laptop provisioning #IT\n- Tier 2 tickets — VPN and M365 issues #IT\n- Backup system verification #IT", updatedAt: "2026-02-10T15:04:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-11", content: "Helpdesk queue was rough today. Escalations around M365 sync.", updatedAt: "2026-02-11T16:51:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-12", content: "WFH — light ticket triage only.", updatedAt: "2026-02-12T12:01:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-13", content: "- Office WiFi coverage survey #IT\n- Weekly infra check-in #General\n- Onboarding new finance team member #HR", updatedAt: "2026-02-13T15:36:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-16", content: "Offsite — certification exam day.", updatedAt: "2026-02-16T09:20:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-17", content: "Office WiFi survey in the west wing. Three dead spots identified.", updatedAt: "2026-02-17T15:16:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-18", content: "Offsite — certification exam day.", updatedAt: "2026-02-18T15:48:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-19", content: "Spent the afternoon studying for the CCNA exam.", updatedAt: "2026-02-19T15:34:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-20", content: "- Backup system verification #IT\n- Office WiFi coverage survey #IT\n- Onboarding new finance team member #HR\n- DNS configuration audit #IT", updatedAt: "2026-02-20T11:30:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-23", content: "- Tier 2 tickets — VPN and M365 issues #IT\n- Weekly infra check-in #General\n- Backup system verification #IT\n- Printer fleet maintenance #IT\n- Network switch firmware upgrade #IT", updatedAt: "2026-02-23T16:25:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-24", content: "- Printer fleet maintenance #IT\n- Tier 2 tickets — VPN and M365 issues #IT\n- DNS configuration audit #IT\n- Office WiFi coverage survey #IT", updatedAt: "2026-02-24T09:03:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-25", content: "Rack-mounting the new switch. Cable management took longer than the install.", updatedAt: "2026-02-25T11:03:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-26", content: "- Office WiFi coverage survey #IT\n- Cisco certification study #General\n- Printer fleet maintenance #IT", updatedAt: "2026-02-26T17:42:00.000Z" },
  { employeeId: "EMP011", date: "2026-02-27", content: "- Office WiFi coverage survey #IT\n- DNS configuration audit #IT\n- Tier 2 tickets — VPN and M365 issues #IT\n- Backup system verification #IT\n- Onboarding new finance team member #HR", updatedAt: "2026-02-27T09:21:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-02", content: "- Tier 2 tickets — VPN and M365 issues #IT\n- Printer fleet maintenance #IT\n- Office WiFi coverage survey #IT", updatedAt: "2026-03-02T09:13:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-03", content: "Spent the afternoon studying for the CCNA exam.", updatedAt: "2026-03-03T17:19:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-04", content: "- Weekly infra check-in #General\n- DNS configuration audit #IT\n- Office WiFi coverage survey #IT\n- Cisco certification study #General", updatedAt: "2026-03-04T10:46:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-05", content: "WFH — light ticket triage only.", updatedAt: "2026-03-05T15:07:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-06", content: "PTO.", updatedAt: "2026-03-06T12:30:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-09", content: "PTO.", updatedAt: "2026-03-09T14:41:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-10", content: "PTO.", updatedAt: "2026-03-10T12:57:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-11", content: "- Printer fleet maintenance #IT\n- Onboarding new finance team member #HR\n- Backup system verification #IT\n- Network switch firmware upgrade #IT\n- Cisco certification study #General", updatedAt: "2026-03-11T13:16:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-12", content: "PTO.", updatedAt: "2026-03-12T12:02:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-13", content: "- DNS configuration audit #IT\n- Tier 2 tickets — VPN and M365 issues #IT\n- Office WiFi coverage survey #IT", updatedAt: "2026-03-13T09:35:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-16", content: "- Network switch firmware upgrade #IT\n- Cisco certification study #General\n- New hire laptop provisioning #IT", updatedAt: "2026-03-16T13:57:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-17", content: "Pair-shadowing @AUII tenant issue with Carlos Garcia.", updatedAt: "2026-03-17T17:53:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-18", content: "- Tier 2 tickets — VPN and M365 issues #IT\n- New hire laptop provisioning #IT\n- Backup system verification #IT\n- Cisco certification study #General\n- Onboarding new finance team member #HR", updatedAt: "2026-03-18T16:50:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-19", content: "Helpdesk queue was rough today. Escalations around M365 sync.", updatedAt: "2026-03-19T17:41:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-20", content: "Office WiFi survey in the west wing. Three dead spots identified.", updatedAt: "2026-03-20T14:03:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-23", content: "- Tier 2 tickets — VPN and M365 issues #IT\n- Office WiFi coverage survey #IT\n- DNS configuration audit #IT\n- Onboarding new finance team member #HR\n- Printer fleet maintenance #IT", updatedAt: "2026-03-23T11:45:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-24", content: "Helpdesk queue was rough today. Escalations around M365 sync.", updatedAt: "2026-03-24T17:03:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-25", content: "- Backup system verification #IT\n- Office WiFi coverage survey #IT\n- Weekly infra check-in #General", updatedAt: "2026-03-25T16:29:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-26", content: "- Onboarding new finance team member #HR\n- Network switch firmware upgrade #IT\n- Office WiFi coverage survey #IT\n- Cisco certification study #General\n- Tier 2 tickets — VPN and M365 issues #IT", updatedAt: "2026-03-26T09:32:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-27", content: "Spent the afternoon studying for the CCNA exam.", updatedAt: "2026-03-27T11:28:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-30", content: "- Printer fleet maintenance #IT\n- Onboarding new finance team member #HR\n- New hire laptop provisioning #IT\n- Backup system verification #IT\n- Weekly infra check-in #General", updatedAt: "2026-03-30T15:07:00.000Z" },
  { employeeId: "EMP011", date: "2026-03-31", content: "- Network switch firmware upgrade #IT\n- DNS configuration audit #IT\n- Backup system verification #IT\n- Office WiFi coverage survey #IT", updatedAt: "2026-03-31T09:27:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-01", content: "Helpdesk queue was rough today. Escalations around M365 sync.", updatedAt: "2026-04-01T09:57:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-02", content: "- Printer fleet maintenance #IT\n- DNS configuration audit #IT\n- Tier 2 tickets — VPN and M365 issues #IT\n- Network switch firmware upgrade #IT", updatedAt: "2026-04-02T11:52:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-03", content: "Pair-shadowing @AUII tenant issue with Carlos Garcia.", updatedAt: "2026-04-03T12:55:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-06", content: "- DNS configuration audit #IT\n- Backup system verification #IT\n- Onboarding new finance team member #HR\n- Weekly infra check-in #General", updatedAt: "2026-04-06T13:36:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-07", content: "- Office WiFi coverage survey #IT\n- DNS configuration audit #IT\n- Backup system verification #IT\n- Onboarding new finance team member #HR\n- Cisco certification study #General", updatedAt: "2026-04-07T12:42:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-08", content: "- Weekly infra check-in #General\n- DNS configuration audit #IT\n- Tier 2 tickets — VPN and M365 issues #IT\n- Backup system verification #IT\n- Cisco certification study #General", updatedAt: "2026-04-08T17:49:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-09", content: "Spent the afternoon studying for the CCNA exam.", updatedAt: "2026-04-09T13:39:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-10", content: "Offsite — certification exam day.", updatedAt: "2026-04-10T09:44:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-13", content: "- Printer fleet maintenance #IT\n- Weekly infra check-in #General\n- New hire laptop provisioning #IT", updatedAt: "2026-04-13T15:25:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-14", content: "- Onboarding new finance team member #HR\n- Backup system verification #IT\n- Office WiFi coverage survey #IT\n- Network switch firmware upgrade #IT", updatedAt: "2026-04-14T13:11:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-15", content: "- Weekly infra check-in #General\n- Cisco certification study #General\n- DNS configuration audit #IT\n- Office WiFi coverage survey #IT", updatedAt: "2026-04-15T13:37:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-16", content: "- Tier 2 tickets — VPN and M365 issues #IT\n- Backup system verification #IT\n- @AUII #Geniisys helpdesk user support tickets #Projects", updatedAt: "2026-04-16T09:30:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-17", content: "PTO.", updatedAt: "2026-04-17T08:04:00.000Z" },
  { employeeId: "EMP011", date: "2026-04-20", content: "- Network switch firmware upgrade #IT\n- @AUII #Geniisys regression test execution post-deployment #Projects\n- Onboarding new finance team member #HR", updatedAt: "2026-04-20T17:33:00.000Z" },

  // ── Jose Escobar (EMP001) — March history only; April left blank for demo ──
  { employeeId: "EMP001", date: "2026-03-03", content: "- @AUII #Geniisys core API sprint kickoff — implementing authentication module - 35%\n- @AUII #Geniisys claims workflow refactor planning - 20%\n- Sprint planning and team standup #General", updatedAt: "2026-03-03T17:00:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-04", content: "- @AUII #Geniisys authentication module development - 40%\n- @PNBGEN #Geniisys Quick Policy engine scaffolding - 30%\n- CI/CD pipeline config for Geniisys deployments #IT", updatedAt: "2026-03-04T16:30:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-05", content: "- @PNBGEN #Geniisys Quick Policy rule engine first pass - 25%\n- @AUII #Geniisys claims module code review - 20%\n- Team sync and retrospective #General", updatedAt: "2026-03-05T15:45:00.000Z" },
  { employeeId: "EMP001", date: "2026-03-10", content: "- @AUII #Geniisys integration testing for auth module - 30%\n- @PNBGEN #Geniisys Quick Policy engine unit tests - 20%\n- AWS ECS deployment config #IT", updatedAt: "2026-03-10T17:15:00.000Z" },

  // ── Rico Mendoza (EMP006) — Geniisys Developer ────────────────────
  { employeeId: "EMP006", date: "2026-03-03", content: "- @AUII #Geniisys claims processing module — SR-2201 development - 40%\n- @AUII #Geniisys document management component refactor - 20%\n- Sprint planning #General", updatedAt: "2026-03-03T16:30:00.000Z" },
  { employeeId: "EMP006", date: "2026-03-04", content: "- @CPAIC #Geniisys Quick Policy product build kickoff - 25%\n- @AUII #Geniisys claims module unit tests - 20%\n- Code review session with Jose and Paolo", updatedAt: "2026-03-04T17:15:00.000Z" },
  { employeeId: "EMP006", date: "2026-03-10", content: "- @CPAIC #Geniisys Quick Policy QA — test plan execution - 10%\n- @AUII #Geniisys document management enhancements - 20%\n- @CPAIC #Geniisys Quick Policy feature build - 30%", updatedAt: "2026-03-10T16:00:00.000Z" },
  { employeeId: "EMP006", date: "2026-04-01", content: "- @AUII #Geniisys SR-2345 policy rules implementation sprint - 35%\n- @PNBGEN #Quick Policy Quick Policy core engine development - 30%\n- Architecture standup #General", updatedAt: "2026-04-01T17:30:00.000Z" },
  { employeeId: "EMP006", date: "2026-04-07", content: "- @AUII #Geniisys workflow automation enhancements - 15%\n- @PNBGEN #Quick Policy Quick Policy UAT support and defect fixes - 10%\n- Technical documentation for Quick Policy module - 5%", updatedAt: "2026-04-07T16:45:00.000Z" },
  { employeeId: "EMP006", date: "2026-04-14", content: "- @PNBGEN #Quick Policy Quick Policy engine final testing - 30%\n- @AUII #Geniisys SR-2345 code review and sign-off - 20%\n- Sprint retrospective and planning #General", updatedAt: "2026-04-14T15:00:00.000Z" },

  // ── Roberto Cruz (HEAD001) — IT Department Head personal logs ──────
  { employeeId: "HEAD001", date: "2026-03-03", content: "- @AUII #Geniisys architecture review — authentication module sign-off - 30%\n- @AUII #Geniisys Quick Policy executive alignment meeting - 15%\n- IT governance quarterly review #IT", updatedAt: "2026-03-03T18:00:00.000Z" },
  { employeeId: "HEAD001", date: "2026-03-04", content: "- @CPAIC #Quick Policy Quick Policy program planning session - 20%\n- IT roadmap review with vendors #IT\n- 1:1s with direct reports #General", updatedAt: "2026-03-04T17:30:00.000Z" },
  { employeeId: "HEAD001", date: "2026-03-10", content: "- IT security risk review #IT\n- @AUII #Geniisys technical steering committee - 15%\n- Department budget planning #General", updatedAt: "2026-03-10T17:00:00.000Z" },
  { employeeId: "HEAD001", date: "2026-04-01", content: "- @AUII #Geniisys architecture code review and guidance - 25%\n- @AUII #Geniisys Quick Policy client steering committee - 15%\n- IT security governance — board update prep #IT", updatedAt: "2026-04-01T18:00:00.000Z" },
  { employeeId: "HEAD001", date: "2026-04-07", content: "- @PNBGEN #Quick Policy Quick Policy scope review and sign-off - 15%\n- Platform strategy review with engineering leads #IT\n- 1:1s with Jose, Carlos, Kim, Rico #General", updatedAt: "2026-04-07T17:30:00.000Z" },
  { employeeId: "HEAD001", date: "2026-04-14", content: "- @AUII #Geniisys progress review — SR-2345 milestone sign-off - 20%\n- Department budget review and resource planning #General\n- IT risk committee meeting #IT", updatedAt: "2026-04-14T16:30:00.000Z" },

  // ── May 2026 entries with explicit time blocks — Team Activity Calendar demo ──
  // These cover weekdays May 1, 4, and 5 (today) so the calendar has visible dots
  // and the Activity Feed shows rich per-employee data.

  // === May 1, 2026 (Friday) ===
  { employeeId: "EMP001", date: "2026-05-01",
    content: "9:00am @AUII #IT Kubernetes deployment tasks\n11:30am @PNBGEN #Projects claims module endpoint work\n1:00pm Sprint planning session #Projects\n3:30pm",
    blocks: [
      { id: "e1-0501-b1", startTime: "09:00", endTime: "11:30", description: "@AUII #IT Kubernetes deployment — rolling update to v1.29" },
      { id: "e1-0501-b2", startTime: "11:30", endTime: "13:00", description: "@PNBGEN #Projects claims module endpoint work" },
      { id: "e1-0501-b3", startTime: "14:00", endTime: "15:30", description: "#Projects sprint planning and backlog grooming" },
    ], updatedAt: "2026-05-01T15:30:00.000Z" },

  { employeeId: "EMP004", date: "2026-05-01",
    content: "SOC 2 compliance documentation — end-of-month review with legal.",
    updatedAt: "2026-05-01T16:00:00.000Z" },

  { employeeId: "EMP005", date: "2026-05-01",
    content: "9:00am @AUII #IT ECS cluster maintenance\n11:00am @PNBGEN #IT CI/CD pipeline review\n1:00pm #IT Incident response drill\n3:00pm",
    blocks: [
      { id: "e5-0501-b1", startTime: "09:00", endTime: "11:00", description: "@AUII #IT ECS cluster health check and maintenance" },
      { id: "e5-0501-b2", startTime: "11:00", endTime: "13:00", description: "@PNBGEN #IT CI/CD pipeline performance review" },
      { id: "e5-0501-b3", startTime: "14:00", endTime: "15:00", description: "#IT Incident response drill — tabletop exercise" },
    ], updatedAt: "2026-05-01T15:00:00.000Z" },

  { employeeId: "EMP007", date: "2026-05-01",
    content: "9:00am @AUII #Geniisys end-of-sprint regression testing\n12:00pm @PNBGEN #Quick Policy release verification\n2:00pm Sprint retrospective #General\n4:30pm",
    blocks: [
      { id: "e7-0501-b1", startTime: "09:00", endTime: "12:00", description: "@AUII #Geniisys end-of-sprint regression testing" },
      { id: "e7-0501-b2", startTime: "13:00", endTime: "14:00", description: "@PNBGEN #Quick Policy release verification and sign-off" },
      { id: "e7-0501-b3", startTime: "14:00", endTime: "16:30", description: "#General sprint retrospective and planning" },
    ], updatedAt: "2026-05-01T16:30:00.000Z" },

  { employeeId: "EMP011", date: "2026-05-01",
    content: "- #IT Printer fleet maintenance\n- #IT Backup system verification\n- #IT DNS configuration audit\n- #General Weekly infra check-in",
    updatedAt: "2026-05-01T17:00:00.000Z" },

  // === May 4, 2026 (Monday) ===
  { employeeId: "EMP001", date: "2026-05-04",
    content: "- Team standup #General\n- @AUII #IT AWS migration planning\n- @PNBGEN #Projects API bug triage\n- Sprint retrospective #Projects",
    updatedAt: "2026-05-04T17:00:00.000Z" },

  { employeeId: "EMP004", date: "2026-05-04",
    content: "9:30am @AUII #IT Firewall rule review\n12:00pm Cross-team security sync #General\n1:00pm @PNBGEN #IT OWASP compliance review\n4:00pm",
    blocks: [
      { id: "e4-0504-b1", startTime: "09:30", endTime: "12:00", description: "@AUII #IT Firewall rule review — decommissioning stale entries" },
      { id: "e4-0504-b2", startTime: "13:00", endTime: "14:00", description: "#General Cross-team security sync" },
      { id: "e4-0504-b3", startTime: "14:00", endTime: "16:00", description: "@PNBGEN #IT OWASP compliance review" },
    ], updatedAt: "2026-05-04T16:00:00.000Z" },

  { employeeId: "EMP005", date: "2026-05-04",
    content: "- @AUII #IT DevOps pipeline maintenance\n- @PNBGEN #IT monitoring alert tuning\n- Team standup #General",
    updatedAt: "2026-05-04T17:00:00.000Z" },

  { employeeId: "EMP006", date: "2026-05-04",
    content: "9:00am @AUII #Geniisys sprint planning and backlog refinement\n11:00am @CPAIC #Quick Policy product roadmap review\n1:00pm Architecture standup #General\n2:00pm",
    blocks: [
      { id: "e6-0504-b1", startTime: "09:00", endTime: "11:00", description: "@AUII #Geniisys sprint planning and backlog refinement" },
      { id: "e6-0504-b2", startTime: "11:00", endTime: "13:00", description: "@CPAIC #Quick Policy product roadmap and feature prioritization" },
      { id: "e6-0504-b3", startTime: "14:00", endTime: "15:00", description: "#General Architecture standup with engineering leads" },
    ], updatedAt: "2026-05-04T15:00:00.000Z" },

  { employeeId: "EMP011", date: "2026-05-04",
    content: "- #IT New hire laptop provisioning (x2)\n- #HR Onboarding new finance team member\n- #IT Office WiFi coverage survey — east wing\n- #General Weekly infra check-in",
    updatedAt: "2026-05-04T17:00:00.000Z" },

  // === May 5, 2026 (Tuesday — today) ===
  { employeeId: "EMP001", date: "2026-05-05",
    content: "9:00am @AUII #IT CI/CD pipeline optimization\n11:30am @PNBGEN #Projects API integration — new claims endpoint\n5:00pm",
    blocks: [
      { id: "e1-0505-b1", startTime: "09:00", endTime: "11:30", description: "@AUII #IT CI/CD pipeline optimization and build time reduction" },
      { id: "e1-0505-b2", startTime: "12:00", endTime: "17:00", description: "@PNBGEN #Projects API integration sprint — new claims endpoint" },
    ], updatedAt: "2026-05-05T17:00:00.000Z" },

  { employeeId: "EMP004", date: "2026-05-05",
    content: "9:30am @UCPB #IT IAM policy audit\n12:00pm @AUII #IT Penetration test execution\n5:00pm",
    blocks: [
      { id: "e4-0505-b1", startTime: "09:30", endTime: "12:00", description: "@UCPB #IT IAM policy audit — access control matrix update" },
      { id: "e4-0505-b2", startTime: "13:00", endTime: "17:00", description: "@AUII #IT Penetration test execution — SSRF vector follow-up" },
    ], updatedAt: "2026-05-05T17:00:00.000Z" },

  { employeeId: "EMP005", date: "2026-05-05",
    content: "9:00am @AUII #IT Kubernetes cluster node upgrade\n12:00pm @PNBGEN #IT Infrastructure deployment\n5:30pm",
    blocks: [
      { id: "e5-0505-b1", startTime: "09:00", endTime: "12:00", description: "@AUII #IT Kubernetes cluster node upgrade to v1.29" },
      { id: "e5-0505-b2", startTime: "13:00", endTime: "17:30", description: "@PNBGEN #IT Infrastructure deployment and monitoring setup" },
    ], updatedAt: "2026-05-05T17:30:00.000Z" },

  { employeeId: "EMP006", date: "2026-05-05",
    content: "9:00am @AUII #Geniisys SR-2345 policy engine development\n1:00pm @CPAIC #Quick Policy UAT support\n5:30pm",
    blocks: [
      { id: "e6-0505-b1", startTime: "09:00", endTime: "13:00", description: "@AUII #Geniisys SR-2345 policy rules development sprint" },
      { id: "e6-0505-b2", startTime: "14:00", endTime: "17:30", description: "@CPAIC #Quick Policy UAT support and defect resolution" },
    ], updatedAt: "2026-05-05T17:30:00.000Z" },

  { employeeId: "EMP007", date: "2026-05-05",
    content: "9:00am @AUII #Geniisys regression test suite\n1:00pm @PNBGEN #Quick Policy UAT execution\n5:00pm",
    blocks: [
      { id: "e7-0505-b1", startTime: "09:00", endTime: "13:00", description: "@AUII #Geniisys regression test suite — sprint 24 coverage" },
      { id: "e7-0505-b2", startTime: "14:00", endTime: "17:00", description: "@PNBGEN #Quick Policy UAT test plan execution" },
    ], updatedAt: "2026-05-05T17:00:00.000Z" },

  { employeeId: "EMP011", date: "2026-05-05",
    content: "9:00am #IT Tier 2 helpdesk — VPN and M365 issues\n11:00am #IT Network switch firmware upgrade\n1:00pm #IT Backup system verification\n5:00pm",
    blocks: [
      { id: "e11-0505-b1", startTime: "09:00", endTime: "11:00", description: "#IT Tier 2 helpdesk — VPN and M365 escalations" },
      { id: "e11-0505-b2", startTime: "11:00", endTime: "13:00", description: "#IT Network switch firmware upgrade — core switch batch" },
      { id: "e11-0505-b3", startTime: "14:00", endTime: "17:00", description: "#IT Backup system verification and documentation update" },
    ], updatedAt: "2026-05-05T17:00:00.000Z" },
];

const LocalJournalProvider = ({ children }: { children: ReactNode }) => {
  // Lazy init: hydrate from storage if available, otherwise use seed
  // entries. Runs once on mount.
  const [entries, setEntries] = useState<JournalEntry[]>(() => {
    const stored = getDataClient().read<JournalEntry[]>("journal");
    return stored ?? SEED_ENTRIES;
  });

  // Persist on every entries change. Writes are infrequent in practice
  // — the DailyJournal UI only saves on the Save button or on
  // date-switch (via the Phase 2 dirty-guard), not on every keystroke.
  useEffect(() => {
    getDataClient().write("journal", entries);
  }, [entries]);

  const getEntry = (employeeId: string, date: string) =>
    entries.find(e => e.employeeId === employeeId && e.date === date);

  const saveEntry = (employeeId: string, date: string, content: string, blocks: TimeBlock[] = []) => {
    setEntries(prev => {
      const existing = prev.findIndex(
        e => e.employeeId === employeeId && e.date === date,
      );
      const entry: JournalEntry = {
        employeeId,
        date,
        content,
        blocks,
        updatedAt: new Date().toISOString(),
      };
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = entry;
        return updated;
      }
      return [...prev, entry];
    });
  };

  const getEntriesForMonth = (employeeId: string, year: number, month: number) => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    return entries.filter(
      e => e.employeeId === employeeId && e.date.startsWith(prefix),
    );
  };

  const getDatesWithEntries = (employeeId: string) =>
    new Set(
      entries
        .filter(e => e.employeeId === employeeId && (e.content.trim() || (e.blocks && e.blocks.length > 0)))
        .map(e => e.date),
    );

  /**
   * Rename @CLIENT tags across every entry's content. Uses a word-
   * boundary regex so only complete tag tokens match. Regex-escapes
   * the old name so client codes with unusual characters (e.g.
   * "BD/Mktg") survive intact.
   */
  const renameClientTag = (oldName: string, newName: string) => {
    if (oldName === newName) return;
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match @<oldName> where the next char is not a word character.
    // This ensures @AUII doesn't match inside @AUIIX.
    const pattern = new RegExp(`@${escaped}(?=\\W|$)`, "g");
    setEntries((prev) =>
      prev.map((e) => {
        const next = e.content.replace(pattern, `@${newName}`);
        return next === e.content
          ? e
          : { ...e, content: next, updatedAt: new Date().toISOString() };
      }),
    );
  };

  return (
    <JournalContext.Provider
      value={{
        entries,
        getEntry,
        saveEntry,
        getEntriesForMonth,
        getDatesWithEntries,
        renameClientTag,
      }}
    >
      {children}
    </JournalContext.Provider>
  );
};

// ── API-backed provider ───────────────────────────────────────────────────────

const ApiJournalProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const { currentUser } = useAuth();

  // Fetch all entries for the current user.
  // Managers/admins can also see other users' entries; those are fetched
  // on demand (individual getEntry calls) rather than bulk-loading every
  // employee's entire history up-front.
  const { data: apiEntries = [] } = useQuery({
    queryKey: ["journal"],
    queryFn: ({ signal }) => api.journal.list(undefined, signal),
    enabled: !!currentUser,
    staleTime: 30_000,
  });

  const entries: JournalEntry[] = apiEntries.map((e) => ({
    employeeId: e.employeeId,
    date: e.date,
    content: e.content,
    blocks: e.blocks as TimeBlock[] | undefined,
    updatedAt: e.updatedAt,
  }));

  const inv = useCallback(
    () => qc.invalidateQueries({ queryKey: ["journal"] }),
    [qc],
  );

  const upsertMut = useMutation({
    mutationFn: ({
      date,
      content,
      blocks,
    }: {
      date: string;
      content: string;
      blocks?: TimeBlock[];
    }) => api.journal.upsert(date, { content, blocks: blocks as Parameters<typeof api.journal.upsert>[1]["blocks"] }),
    onSuccess: inv,
  });

  const getEntry = useCallback(
    (employeeId: string, date: string) =>
      entries.find((e) => e.employeeId === employeeId && e.date === date),
    [entries],
  );

  const saveEntry = useCallback(
    (employeeId: string, date: string, content: string, blocks: TimeBlock[] = []) => {
      // Only the current user's own entries can be saved via the API
      if (employeeId === currentUser?.id) {
        upsertMut.mutate({ date, content, blocks });
      }
    },
    [currentUser, upsertMut],
  );

  const getEntriesForMonth = useCallback(
    (employeeId: string, year: number, month: number) => {
      const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      return entries.filter(
        (e) => e.employeeId === employeeId && e.date.startsWith(prefix),
      );
    },
    [entries],
  );

  const getDatesWithEntries = useCallback(
    (employeeId: string) =>
      new Set(
        entries
          .filter(
            (e) =>
              e.employeeId === employeeId &&
              (e.content.trim() || (e.blocks && e.blocks.length > 0)),
          )
          .map((e) => e.date),
      ),
    [entries],
  );

  // Client rename is server-side in API mode; no-op on the client
  const renameClientTag = useCallback(() => {}, []);

  return (
    <JournalContext.Provider
      value={{
        entries,
        getEntry,
        saveEntry,
        getEntriesForMonth,
        getDatesWithEntries,
        renameClientTag,
      }}
    >
      {children}
    </JournalContext.Provider>
  );
};

// ── Public export — dispatches based on VITE_USE_API ─────────────────────────

export const JournalProvider = ({ children }: { children: ReactNode }) => {
  const isApiMode = import.meta.env.VITE_USE_API === "true";
  if (isApiMode) return <ApiJournalProvider>{children}</ApiJournalProvider>;
  return <LocalJournalProvider>{children}</LocalJournalProvider>;
};
