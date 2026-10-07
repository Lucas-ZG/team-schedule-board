export type DeleteUserPreview = {
  targetId: string; confirmName: string; cutoffDate: string;
  futureCount: number; futureDayoffCount: number; retainedCount: number;
};
export type DeleteUserStatus = { profileExists: boolean; historyDeleted: boolean; authExists: boolean; authDisabled: boolean };

const MESSAGES: Record<string, string> = {
  SELF_DELETE: "不能刪除自己的帳號。",
  ROLE_FORBIDDEN: "只能刪除 user 或 viewer 帳號。",
  NAME_MISMATCH: "輸入的帳號名稱不完全一致。",
  PREVIEW_CHANGED: "資料已變更，請重新確認影響摘要後再輸入帳號名稱確認。",
  DISABLE_FAILED: "無法先停用帳號，資料未變更，請稍後重試。",
  CLEANUP_FAILED: "資料清理失敗，帳號已恢復，資料未變更。",
  ROLLBACK_UNBAN_FAILED: "資料清理失敗，且帳號解除停用失敗，請立即聯絡管理員人工處理。",
  AUTH_DELETE_PENDING: "刪除未完成：帳號已停用、資料已清理，請按「重試完成刪除」。",
  RETRY_NOT_ALLOWED: "目前狀態不允許重試完成刪除，請重新整理後確認帳號狀態。",
  AUTH_STATUS_UNKNOWN: "暫時無法確認帳號狀態，請稍後重試。",
  DELETE_STATE_UNKNOWN: "無法確認資料清理是否完成：帳號仍為停用狀態，請按「重試刪除」，或稍後再確認。",
};
const GENERIC_MESSAGE = "刪除失敗，請稍後重試。";

// Never echo server text for unknown codes: it could carry internal details. Known codes map to fixed messages.
export function messageForCode(code: string | null, httpStatus: number | null): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (httpStatus === 401) return "登入已失效，請重新登入。";
  if (httpStatus === 403) return "只有管理員可以執行此操作。";
  if (httpStatus === 404) return "找不到目標帳號，可能已被刪除。";
  return GENERIC_MESSAGE;
}

export class DeleteUserApiError extends Error {
  code: string | null;
  httpStatus: number | null;
  preview: DeleteUserPreview | null;
  network: boolean;
  constructor(message: string, code: string | null, httpStatus: number | null, preview: DeleteUserPreview | null, network: boolean) {
    super(message);
    this.name = "DeleteUserApiError";
    this.code = code; this.httpStatus = httpStatus; this.preview = preview; this.network = network;
  }
}

function asPreview(value: unknown): DeleteUserPreview | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  return typeof v.targetId === "string" && typeof v.confirmName === "string" && typeof v.cutoffDate === "string" &&
    [v.futureCount, v.futureDayoffCount, v.retainedCount].every((n) => typeof n === "number")
    ? (v as unknown as DeleteUserPreview) : null;
}

// supabase-js functions.invoke() returns data=null on non-2xx; the JSON body sits in error.context (a Response).
export async function toDeleteUserError(error: unknown): Promise<DeleteUserApiError> {
  const e = error as { name?: string; context?: unknown } | null;
  if (e && e.name === "FunctionsHttpError" && e.context && typeof (e.context as Response).json === "function") {
    const response = e.context as Response;
    let body: Record<string, unknown> | null = null;
    try { body = (await response.json()) as Record<string, unknown>; } catch { body = null; }
    const code = body && typeof body.code === "string" ? body.code : null;
    return new DeleteUserApiError(messageForCode(code, response.status), code, response.status, asPreview(body?.preview), false);
  }
  // FunctionsFetchError (network/abort/timeout), FunctionsRelayError or anything thrown: no usable answer.
  return new DeleteUserApiError(GENERIC_MESSAGE, null, null, null, true);
}

export type FailureClass = "definitive" | "preview-changed" | "uncertain";

const DEFINITIVE_CODES = new Set(["SELF_DELETE", "ROLE_FORBIDDEN", "NAME_MISMATCH", "DISABLE_FAILED", "CLEANUP_FAILED", "ROLLBACK_UNBAN_FAILED", "RETRY_NOT_ALLOWED"]);

// "definitive": the backend told us exactly what happened. "uncertain": the answer cannot decide the screen by itself
// (network, timeout, 5xx without a known code, AUTH_STATUS_UNKNOWN, and also AUTH_DELETE_PENDING / DELETE_STATE_UNKNOWN:
// the latter is also returned when the cleanup-state query itself failed, so it does not prove the data is uncleaned)
// -> the UI must ask the status action before telling the user anything.
export function classifyFailure(error: DeleteUserApiError): FailureClass {
  if (error.code === "PREVIEW_CHANGED") return "preview-changed";
  if (error.code === "AUTH_DELETE_PENDING" || error.code === "DELETE_STATE_UNKNOWN") return "uncertain";
  if (error.code && DEFINITIVE_CODES.has(error.code)) return "definitive";
  if (error.httpStatus === 401 || error.httpStatus === 403 || error.httpStatus === 404) return "definitive";
  return "uncertain";
}

// True when the screen must be decided by the status action. `afterUnknown` is set when an earlier attempt already left
// the outcome open (stuck banner shown): a 404 then only means "profile no longer exists", which is exactly what a
// cleaned-but-not-yet-hard-deleted account looks like, so it is never a definitive failure.
export function requiresStatusCheck(error: DeleteUserApiError, afterUnknown: boolean): boolean {
  if (classifyFailure(error) === "uncertain") return true;
  if (error.code === "RETRY_NOT_ALLOWED") return true;
  return afterUnknown && error.httpStatus === 404;
}

export type StatusVerdict = "deleted" | "pending-retry" | "stuck-uncleaned" | "not-deleted" | "inconsistent";

export function interpretStatus(s: DeleteUserStatus): StatusVerdict {
  if (!s.profileExists && s.historyDeleted && !s.authExists) return "deleted";
  if (!s.profileExists && s.historyDeleted && s.authExists && s.authDisabled) return "pending-retry";
  if (s.profileExists && !s.historyDeleted && s.authExists && s.authDisabled) return "stuck-uncleaned";
  if (s.profileExists && !s.historyDeleted && s.authExists && !s.authDisabled) return "not-deleted";
  return "inconsistent";
}
