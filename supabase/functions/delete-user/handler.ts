import { requireAdminCaller } from "../create-user/handler.ts";

export type HandlerResult = { status: number; body: Record<string, unknown> };

type Counts = { cutoffDate: string; futureCount: number; futureDayoffCount: number; retainedCount: number };
type AuthLookup = { kind: "exists"; disabled: boolean } | { kind: "absent" } | { kind: "unknown" };
type CleanupOutcome =
  | { kind: "committed"; data: unknown }
  | { kind: "db-error"; error: { code?: string; message?: string } }
  | { kind: "lost" };
type CleanupState = "cleaned" | "not-cleaned" | "unknown";

const BAN_FOREVER = "876000h";

class AuthStatusUnknownError extends Error {}

function result(status: number, body: Record<string, unknown>): HandlerResult {
  return { status, body };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same rule as the SQL side (nullif(...,'')): an empty string is a missing value.
function targetName(profile: Record<string, unknown>): string {
  return String(profile.display_name || profile.email || profile.id);
}

async function getTarget(admin: any, targetId: string) {
  const query = await admin.from("profiles").select("id,display_name,email,role").eq("id", targetId).maybeSingle();
  if (query.error) throw new Error("target_lookup_failed");
  return query.data as Record<string, unknown> | null;
}

// Single counting rule lives in the database (delete_user_counts); preview and delete_user_data() share it.
async function readCounts(admin: any, targetId: string): Promise<Counts> {
  const query = await admin.rpc("delete_user_counts", { p_target_id: targetId, p_cutoff: null });
  const data = query.data as Record<string, unknown> | null;
  if (query.error || !data || typeof data.cutoffDate !== "string" ||
    ![data.futureCount, data.futureDayoffCount, data.retainedCount].every((value) => Number.isInteger(value))) {
    throw new Error("preview_failed");
  }
  return {
    cutoffDate: data.cutoffDate, futureCount: data.futureCount as number,
    futureDayoffCount: data.futureDayoffCount as number, retainedCount: data.retainedCount as number,
  };
}

function validTarget(callerId: string, target: Record<string, unknown>): HandlerResult | null {
  if (target.id === callerId) return result(400, { code: "SELF_DELETE", error: "不能刪除自己的帳號。" });
  if (target.role !== "user" && target.role !== "viewer") {
    return result(400, { code: "ROLE_FORBIDDEN", error: "只能刪除 user 或 viewer 帳號。" });
  }
  return null;
}

// Only an explicit "user not found" answer (HTTP 404 / user_not_found) means the Auth account is gone.
// Anything else (503, timeout, network error, unknown shape) is "cannot tell".
function isAuthNotFound(error: any): boolean {
  return Boolean(error) && (error.status === 404 || error.code === "user_not_found");
}

async function lookupAuth(admin: any, targetId: string): Promise<AuthLookup> {
  let response: any;
  try { response = await admin.auth.admin.getUserById(targetId); } catch { return { kind: "unknown" }; }
  if (response.error) return isAuthNotFound(response.error) ? { kind: "absent" } : { kind: "unknown" };
  const user = response.data?.user;
  if (!user) return { kind: "unknown" };
  return { kind: "exists", disabled: Boolean(user.banned_until && new Date(user.banned_until) > new Date()) };
}

async function status(admin: any, targetId: string) {
  const [profile, label, auth] = await Promise.all([
    admin.from("profiles").select("id").eq("id", targetId).maybeSingle(),
    admin.from("user_history_labels").select("deleted_at").eq("user_id", targetId).maybeSingle(),
    lookupAuth(admin, targetId),
  ]);
  if (profile.error || label.error) throw new Error("status_lookup_failed");
  if (auth.kind === "unknown") throw new AuthStatusUnknownError();
  const authExists = auth.kind === "exists";
  return {
    profileExists: Boolean(profile.data),
    historyDeleted: Boolean(label.data?.deleted_at),
    authExists,
    authDisabled: authExists && auth.disabled,
  };
}

// An error that carries a SQLSTATE (or PostgREST code) is a definite database answer: the transaction was rolled back.
// A network error, timeout or lost connection carries no such code: the outcome is unknown.
function isExplicitDatabaseError(error: { code?: string } | null | undefined): boolean {
  const code = typeof error?.code === "string" ? error.code : "";
  return (/^[0-9A-Z]{5}$/.test(code) && /\d/.test(code)) || /^PGRST\d+$/.test(code);
}

async function runCleanup(admin: any, args: Record<string, unknown>): Promise<CleanupOutcome> {
  let response: any;
  try { response = await admin.rpc("delete_user_data", args); } catch { return { kind: "lost" }; }
  if (!response.error) return { kind: "committed", data: response.data };
  return isExplicitDatabaseError(response.error) ? { kind: "db-error", error: response.error } : { kind: "lost" };
}

async function readCleanupState(admin: any, targetId: string): Promise<CleanupState> {
  try {
    const [profile, label] = await Promise.all([
      admin.from("profiles").select("id").eq("id", targetId).maybeSingle(),
      admin.from("user_history_labels").select("deleted_at").eq("user_id", targetId).maybeSingle(),
    ]);
    if (profile.error || label.error) return "unknown";
    return !profile.data || label.data?.deleted_at ? "cleaned" : "not-cleaned";
  } catch { return "unknown"; }
}

async function setBan(admin: any, targetId: string, banDuration: string): Promise<boolean> {
  try { return !(await admin.auth.admin.updateUserById(targetId, { ban_duration: banDuration })).error; } catch { return false; }
}

async function hardDeleteAuth(admin: any, targetId: string): Promise<boolean> {
  try {
    const response = await admin.auth.admin.deleteUser(targetId);
    return !response.error || isAuthNotFound(response.error);
  } catch { return false; }
}

const AUTH_DELETE_PENDING = (requestId?: string) => result(502, {
  code: "AUTH_DELETE_PENDING", error: "刪除未完成：帳號已停用、資料已清理，請按「重試完成刪除」。", ...(requestId ? { requestId } : {}),
});

export async function handleDeleteUser(callerClient: any, adminClient: any, rawBody: unknown): Promise<HandlerResult> {
  try {
    const caller = await requireAdminCaller(callerClient);
    if ("status" in caller) return caller;
    if (!isObject(rawBody) || typeof rawBody.action !== "string") return result(400, { error: "請求格式不正確。" });
    const action = rawBody.action;

    if (action === "list") {
      const query = await adminClient.from("profiles").select("id,display_name,email,role,sort_order")
        .in("role", ["user", "viewer"]).neq("id", caller.id).order("sort_order").order("display_name");
      if (query.error) return result(500, { error: "無法載入可刪除帳號。" });
      return result(200, { users: (query.data || []).map((entry: Record<string, unknown>) => ({ ...entry, name: targetName(entry) })) });
    }

    if (typeof rawBody.targetId !== "string") return result(400, { error: "缺少目標帳號。" });
    const targetId = rawBody.targetId;

    if (action === "status") return result(200, await status(adminClient, targetId));

    const target = await getTarget(adminClient, targetId);
    if (!target) {
      if (action === "delete" && rawBody.retry === true) {
        // Stuck state: data already cleaned, Auth account still exists and is disabled -> only the hard delete is left.
        const current = await status(adminClient, targetId);
        if (!current.historyDeleted || !current.authExists || !current.authDisabled) {
          return result(409, { code: "RETRY_NOT_ALLOWED", error: "目前狀態不允許重試完成刪除。", ...current });
        }
        if (!(await hardDeleteAuth(adminClient, targetId))) return AUTH_DELETE_PENDING();
        return result(200, { status: "deleted", retried: true });
      }
      return result(404, { error: "找不到目標帳號。" });
    }
    const invalid = validTarget(caller.id, target);
    if (invalid) return invalid;
    const counts = await readCounts(adminClient, targetId);
    const summary = { targetId: target.id, confirmName: targetName(target), ...counts };
    if (action === "preview") return result(200, summary);
    if (action !== "delete") return result(400, { error: "未知的操作。" });
    if (typeof rawBody.confirmName !== "string" || rawBody.confirmName !== summary.confirmName) {
      return result(400, { code: "NAME_MISMATCH", error: "輸入的帳號名稱不完全一致。" });
    }
    if (rawBody.cutoffDate !== counts.cutoffDate || rawBody.futureCount !== counts.futureCount ||
      rawBody.futureDayoffCount !== counts.futureDayoffCount || rawBody.retainedCount !== counts.retainedCount) {
      return result(409, { code: "PREVIEW_CHANGED", error: "資料已變更，請重新確認影響摘要。", preview: summary });
    }

    // (a) disable (idempotent: a target left disabled by an earlier attempt is simply disabled again)
    if (!(await setBan(adminClient, targetId, BAN_FOREVER))) {
      return result(502, { code: "DISABLE_FAILED", error: "無法先停用帳號，資料未變更。" });
    }
    // (b) database cleanup, then classify the outcome
    const requestId = crypto.randomUUID();
    const cleanup = await runCleanup(adminClient, {
      p_actor_id: caller.id, p_target_id: targetId, p_confirm_name: rawBody.confirmName,
      p_expected_cutoff: rawBody.cutoffDate, p_expected_future_count: rawBody.futureCount,
      p_expected_dayoff_count: rawBody.futureDayoffCount, p_expected_retained_count: rawBody.retainedCount, p_request_id: requestId,
    });
    if (cleanup.kind === "db-error") {
      // Definite database error: the transaction rolled back, so it is safe to re-enable the account.
      const restored = await setBan(adminClient, targetId, "none");
      if (restored && cleanup.error.message?.includes("preview_changed")) {
        let fresh: Record<string, unknown> | undefined;
        try { fresh = { targetId: target.id, confirmName: targetName(target), ...(await readCounts(adminClient, targetId)) }; } catch { /* the client re-previews */ }
        return result(409, { code: "PREVIEW_CHANGED", error: "資料已變更，請重新確認影響摘要。", ...(fresh ? { preview: fresh } : {}) });
      }
      return result(500, restored
        ? { code: "CLEANUP_FAILED", error: "資料清理失敗，帳號已恢復，資料未變更。" }
        : { code: "ROLLBACK_UNBAN_FAILED", error: "資料清理失敗，且帳號解除停用失敗，請立即人工處理。" });
    }
    if (cleanup.kind === "lost") {
      // No usable answer: the transaction may or may not have committed. Never re-enable the account on a guess.
      const state = await readCleanupState(adminClient, targetId);
      if (state !== "cleaned") {
        return result(503, { code: "DELETE_STATE_UNKNOWN", error: "無法確認資料清理是否完成：帳號仍為停用狀態，請重試完成刪除，或稍後查詢狀態。" });
      }
    }
    // (c) hard delete the Auth account
    if (!(await hardDeleteAuth(adminClient, targetId))) return AUTH_DELETE_PENDING(requestId);
    return result(200, { status: "deleted", requestId, cleanup: cleanup.kind === "committed" ? cleanup.data : null });
  } catch (error) {
    if (error instanceof AuthStatusUnknownError) {
      return result(503, { code: "AUTH_STATUS_UNKNOWN", error: "暫時無法確認帳號狀態，請稍後重試。" });
    }
    return result(500, { error: "Delete User 服務暫時無法使用。" });
  }
}
