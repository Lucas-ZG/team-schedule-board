import type { ActivityLog, Workplace } from "@/types/database";

// Human-readable one-line summaries for the /admin/logs Detail column,
// derived from the same before/after/deleted shape Calendar.tsx writes via
// logActivity() (see src/components/Calendar.tsx handleSave/handleDelete/
// handleBatchApply). This is display-only: it never touches what gets
// written to activity_logs, only how it's rendered.

type DailyStatusSnapshot = {
  workplace_id?: string | null;
  workplace_ids?: string[] | null;
  note?: string | null;
  overtime_enabled?: boolean | null;
  overtime_hours?: number | null;
  leave_hours?: number | null;
};

type DailyStatusDetail = {
  work_date?: string;
  before?: DailyStatusSnapshot | null;
  after?: DailyStatusSnapshot | null;
  deleted?: DailyStatusSnapshot | null;
};

export type WorkplaceLookup = Map<string, Workplace>;

export function buildWorkplaceLookup(workplaces: Workplace[]): WorkplaceLookup {
  return new Map(workplaces.map((entry) => [entry.id, entry]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Any signed-in user can insert their own activity_logs row with arbitrary
// `detail` and `target_table` content -- logActivity()'s INSERT policy
// doesn't constrain the shape or content of those fields at all. Fields
// like `work_date` or `target_table` are meant to be short, human-facing
// strings, but nothing stops someone from setting them to a UUID (their
// own user id, a daily_status row id, anything). Rather than trying to
// enumerate and validate every field that could end up embedded in a
// rendered string, this is a final backstop applied to every value this
// module hands back to the UI: if a UUID-shaped substring is present, it
// is replaced so acceptance criterion 6 ("no bare UUIDs in the collapsed
// view") holds regardless of which field it came from.
export function redactUuids(text: string): string {
  return text.replace(UUID_PATTERN, "[id]");
}

function isValidWorkDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

// `detail` (and, inside it, before/after/deleted) is stored as arbitrary
// Json -- logActivity() lets any signed-in user insert their own row with
// whatever `detail` shape they send, so this can't assume a well-formed
// daily_status snapshot. Every field is individually type-checked before
// use; anything that doesn't match the expected shape is treated as absent
// rather than passed through, so a malformed row can never throw here.
function asDailyStatusDetail(detail: ActivityLog["detail"]): DailyStatusDetail {
  if (!isPlainObject(detail)) {
    return {};
  }
  return {
    work_date: typeof detail.work_date === "string" ? detail.work_date : undefined,
    before: asSnapshot(detail.before),
    after: asSnapshot(detail.after),
    deleted: asSnapshot(detail.deleted),
  };
}

function asSnapshot(value: unknown): DailyStatusSnapshot | null {
  if (!isPlainObject(value)) {
    return null;
  }
  return {
    workplace_id: typeof value.workplace_id === "string" ? value.workplace_id : null,
    workplace_ids: isStringArray(value.workplace_ids) ? value.workplace_ids : null,
    note: typeof value.note === "string" ? value.note : null,
    overtime_enabled:
      typeof value.overtime_enabled === "boolean" ? value.overtime_enabled : null,
    overtime_hours:
      typeof value.overtime_hours === "number" ? value.overtime_hours : null,
    leave_hours: typeof value.leave_hours === "number" ? value.leave_hours : null,
  };
}

function formatHours(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function workplaceIdsOf(snapshot: DailyStatusSnapshot | null | undefined): string[] {
  if (!snapshot) {
    return [];
  }
  if (snapshot.workplace_ids && snapshot.workplace_ids.length > 0) {
    return snapshot.workplace_ids;
  }
  return snapshot.workplace_id ? [snapshot.workplace_id] : [];
}

function workplaceLabel(ids: string[], lookup?: WorkplaceLookup): string | null {
  if (ids.length === 0) {
    return null;
  }
  if (!lookup) {
    return null;
  }
  const names = ids.map((id) => {
    const workplace = lookup.get(id);
    if (!workplace) {
      return null;
    }
    return workplace.is_dayoff ? "Dayoff" : workplace.name;
  });
  if (names.some((name) => name === null)) {
    return null;
  }
  return (names as string[]).join("/");
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

// Compares `before` and `after` snapshots and returns one clause per field
// that actually changed. Unchanged fields never appear.
function diffClauses(
  before: DailyStatusSnapshot | null | undefined,
  after: DailyStatusSnapshot | null | undefined,
  lookup?: WorkplaceLookup,
): string[] {
  const clauses: string[] = [];

  const beforeWorkplaceIds = workplaceIdsOf(before);
  const afterWorkplaceIds = workplaceIdsOf(after);
  if (!sameIds(beforeWorkplaceIds, afterWorkplaceIds)) {
    const beforeLabel = workplaceLabel(beforeWorkplaceIds, lookup);
    const afterLabel = workplaceLabel(afterWorkplaceIds, lookup);
    if (beforeLabel !== null && afterLabel !== null) {
      clauses.push(`工作地點從 ${beforeLabel} 改為 ${afterLabel}`);
    } else {
      clauses.push("工作地點已變更");
    }
  }

  const beforeEnabled = Boolean(before?.overtime_enabled);
  const afterEnabled = Boolean(after?.overtime_enabled);
  if (beforeEnabled !== afterEnabled) {
    clauses.push(`加班狀態變更為 ${afterEnabled ? "開啟" : "關閉"}`);
  }

  const beforeOvertimeHours = Number(before?.overtime_hours) || 0;
  const afterOvertimeHours = Number(after?.overtime_hours) || 0;
  if (beforeOvertimeHours !== afterOvertimeHours) {
    clauses.push(
      `加班時數從 ${formatHours(beforeOvertimeHours)} 改為 ${formatHours(afterOvertimeHours)} 小時`,
    );
  }

  const beforeLeaveHours = Number(before?.leave_hours) || 0;
  const afterLeaveHours = Number(after?.leave_hours) || 0;
  if (beforeLeaveHours !== afterLeaveHours) {
    clauses.push(
      `請假時數從 ${formatHours(beforeLeaveHours)} 改為 ${formatHours(afterLeaveHours)} 小時`,
    );
  }

  if ((before?.note || "") !== (after?.note || "")) {
    clauses.push("備註已更新");
  }

  return clauses;
}

// Compact "what was there" fragment for create/delete, e.g. "K5，加班 2.5 小時".
function snapshotFragment(
  snapshot: DailyStatusSnapshot | null | undefined,
  lookup?: WorkplaceLookup,
): string | null {
  if (!snapshot) {
    return null;
  }
  const parts: string[] = [];
  const label = workplaceLabel(workplaceIdsOf(snapshot), lookup);
  if (label) {
    parts.push(label);
  }
  if (snapshot.overtime_enabled && Number(snapshot.overtime_hours) > 0) {
    parts.push(`加班 ${formatHours(Number(snapshot.overtime_hours))} 小時`);
  }
  if (Number(snapshot.leave_hours) > 0) {
    parts.push(`請假 ${formatHours(Number(snapshot.leave_hours))} 小時`);
  }
  return parts.length > 0 ? parts.join("，") : null;
}

function summarize(
  log: ActivityLog,
  userLabel: string,
  workplaces?: WorkplaceLookup,
): string {
  if (log.event_type === "login") {
    return `${userLabel} 登入`;
  }

  const detail = asDailyStatusDetail(log.detail);
  const workDate = detail.work_date;
  const dateFragment = isValidWorkDate(workDate) ? ` ${workDate} 的` : "的";

  if (log.event_type === "create") {
    const extra = snapshotFragment(detail.after, workplaces);
    return `${userLabel} 建立了${dateFragment}排班紀錄${extra ? `（${extra}）` : ""}`;
  }

  if (log.event_type === "delete") {
    const extra = snapshotFragment(detail.deleted, workplaces);
    return `${userLabel} 刪除了${dateFragment}排班紀錄${extra ? `（${extra}）` : ""}`;
  }

  // update
  const clauses = diffClauses(detail.before, detail.after, workplaces);
  if (clauses.length === 0) {
    return "紀錄已更新（無可辨識的欄位變化）";
  }
  return clauses.join("、");
}

// The individual field checks above already guard against malformed
// `detail` JSON (any signed-in user can insert their own activity_logs row
// with arbitrary detail -- see logActivity()), but this outer boundary
// guarantees summarizeActivityLog() itself can never throw and take the
// whole /admin/logs page down with it, no matter what slips through.
export function summarizeActivityLog(
  log: ActivityLog,
  userLabel: string,
  workplaces?: WorkplaceLookup,
): string {
  try {
    return redactUuids(summarize(log, userLabel, workplaces));
  } catch {
    return "紀錄已更新（摘要產生失敗，請展開查看原始資料）";
  }
}
