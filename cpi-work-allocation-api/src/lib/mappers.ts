// Structural types matching Prisma query results with includes
type UserStub = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  team: string;
  managerId: string | null;
  jobTitle: string;
};

type ActivityStub = {
  id: string;
  streamCategory: string;
  subCategory: string | null;
  workType: string;
  client: string;
  description: string;
  percentage: number;
  streamOrder: number;
  activityOrder: number;
  flagReason: string | null;
  flaggedAt: Date | null;
};

type RecordStub = {
  id: string;
  employeeId: string;
  team: string;
  managerId: string | null;
  month: string;
  year: string;
  monthIndex: number;
  status: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  feedback: string | null;
  lastEditedByUserId: string | null;
  lastEditedByUserName: string | null;
  lastEditedAt: Date | null;
  activities: ActivityStub[];
  employee: UserStub;
  manager: UserStub | null;
};

export type StreamsInput = Array<{
  category: string;
  activities: Array<{
    id: string;
    subCategory?: string | null;
    workType: string;
    client: string;
    description: string;
    percentage: number;
  }>;
}>;

export type FlatActivity = {
  id: string;
  streamCategory: string;
  subCategory: string | null;
  workType: string;
  client: string;
  description: string;
  percentage: number;
  streamOrder: number;
  activityOrder: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toFrontendRecord(record: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...(record.activities as any[])].sort((a, b) =>
    a.streamOrder !== b.streamOrder ? a.streamOrder - b.streamOrder : a.activityOrder - b.activityOrder
  );

  const streamMap = new Map<number, { category: string; activities: object[] }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const act of sorted as any[]) {
    if (!streamMap.has(act.streamOrder)) {
      streamMap.set(act.streamOrder, { category: act.streamCategory, activities: [] });
    }
    streamMap.get(act.streamOrder)!.activities.push({
      id: act.id,
      team: record.team,
      workCategory: act.streamCategory,
      subCategory: act.subCategory,
      workType: act.workType,
      client: act.client,
      description: act.description,
      percentage: act.percentage,
      expanded: true,
    });
  }

  const streams = Array.from(streamMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, s]) => ({ category: s.category, activities: s.activities, expanded: true }));

  const flags: Record<string, { reason: string; flaggedAt: string }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const act of record.activities as any[]) {
    if (act.flagReason && act.flaggedAt) {
      flags[act.id] = { reason: act.flagReason, flaggedAt: (act.flaggedAt as Date).toISOString() };
    }
  }

  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: `${record.employee.firstName} ${record.employee.lastName}`,
    employeeEmail: record.employee.email,
    team: record.team,
    managerId: record.managerId ?? '',
    managerName: record.manager
      ? `${record.manager.firstName} ${record.manager.lastName}`
      : '',
    month: record.month,
    year: record.year,
    monthIndex: record.monthIndex,
    streams,
    status: record.status,
    ...(record.submittedAt && { submittedAt: (record.submittedAt as Date).toISOString() }),
    ...(record.reviewedAt && { reviewedAt: (record.reviewedAt as Date).toISOString() }),
    ...(record.feedback != null && { feedback: record.feedback }),
    ...(Object.keys(flags).length > 0 && { flags }),
    ...(record.lastEditedByUserId && {
      lastEditedBy: {
        userId: record.lastEditedByUserId,
        userName: record.lastEditedByUserName as string,
        at: (record.lastEditedAt as Date).toISOString(),
      },
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toFrontendUser(user: any) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    // Always emit a fresh array so callers can mutate without touching the
    // Prisma object's internal reference.
    roles: Array.isArray(user.roles) ? [...user.roles] : [],
    team: user.team,
    managerId: user.managerId,
    jobTitle: user.jobTitle,
  };
}

export function flattenStreams(streams: StreamsInput): FlatActivity[] {
  const result: FlatActivity[] = [];
  for (let si = 0; si < streams.length; si++) {
    const stream = streams[si];
    for (let ai = 0; ai < stream.activities.length; ai++) {
      const act = stream.activities[ai];
      result.push({
        id: act.id,
        streamCategory: stream.category,
        subCategory: act.subCategory ?? null,
        workType: act.workType,
        client: act.client,
        description: act.description,
        percentage: act.percentage,
        streamOrder: si,
        activityOrder: ai,
      });
    }
  }
  return result;
}
