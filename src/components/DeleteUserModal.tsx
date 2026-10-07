"use client";

import { useEffect, useRef, useState } from "react";
import {
  DeleteUserApiError, classifyFailure, interpretStatus, messageForCode, requiresStatusCheck, toDeleteUserError,
  type DeleteUserPreview, type DeleteUserStatus,
} from "@/lib/deleteUserApi";
import { formatMemberName } from "@/lib/displayName";
import { getSupabaseClient } from "@/lib/supabaseClient";

type Target = { id: string; name: string; role: "user" | "viewer" };

const REQUEST_TIMEOUT_MS = 30000;
const REFRESH_FAILED_MESSAGE = "已刪除成功，畫面更新失敗。請重新整理頁面。";

export default function DeleteUserModal({ onClose, onDeleted, onStart }: {
  onClose: () => void;
  // Called when a new delete operation begins (target selected / submit), so the page can drop the previous result message.
  onStart?: () => void;
  // Resolves to true when the calendar, member list and OT data were all refreshed successfully.
  onDeleted: () => Promise<boolean>;
}) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<DeleteUserPreview | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  // "cleaned": data already removed, only the Auth hard delete is left.  "uncleaned": account disabled, data still there.
  const [stuck, setStuck] = useState<"cleaned" | "uncleaned" | null>(null);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const requestSequence = useRef(0);

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error: invokeError } = await getSupabaseClient().functions.invoke("delete-user", { body, timeout: REQUEST_TIMEOUT_MS });
    if (invokeError) throw await toDeleteUserError(invokeError);
    return data as Record<string, unknown>;
  }

  useEffect(() => {
    call({ action: "list" }).then((data) => {
      setTargets((data.users || []) as Target[]); setLoading(false);
    }).catch((reason) => { setError(reason instanceof DeleteUserApiError ? reason.message : "無法載入可刪除帳號。"); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPreview(id: string, sequence: number) {
    setLoading(true);
    try {
      const data = await call({ action: "preview", targetId: id });
      if (sequence === requestSequence.current) setPreview(data as unknown as DeleteUserPreview);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason instanceof DeleteUserApiError ? reason.message : "無法載入影響摘要。");
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }

  async function selectTarget(nextId: string) {
    onStart?.();
    const sequence = ++requestSequence.current;
    setTargetId(nextId); setConfirmName(""); setPreview(null); setStuck(null); setNeedsStatusCheck(false); setError(null);
    if (!nextId) return;
    await loadPreview(nextId, sequence);
  }

  async function finishDeleted() {
    let refreshed = false;
    try { refreshed = await onDeleted(); } catch { refreshed = false; }
    if (refreshed) { onClose(); return; }
    setRefreshFailed(true); setStuck(null); setNeedsStatusCheck(false); setError(REFRESH_FAILED_MESSAGE);
  }

  // The outcome of the request is not known (timeout, network, 5xx): ask the status action before telling the user anything.
  async function resolveByStatus() {
    let current: DeleteUserStatus;
    try { current = (await call({ action: "status", targetId })) as unknown as DeleteUserStatus; }
    catch {
      setNeedsStatusCheck(true);
      setError("暫時無法確認帳號狀態，尚不能確定是否已刪除。請按「重新查詢」。");
      return;
    }
    setNeedsStatusCheck(false);
    switch (interpretStatus(current)) {
      case "deleted": await finishDeleted(); return;
      case "pending-retry": setStuck("cleaned"); setError(messageForCode("AUTH_DELETE_PENDING", null)); return;
      case "stuck-uncleaned": setStuck("uncleaned"); setError(messageForCode("DELETE_STATE_UNKNOWN", null)); return;
      case "not-deleted": setStuck(null); setError("刪除未完成，帳號與資料都沒有變更，可以重新送出。"); return;
      default: setStuck(null); setError("帳號狀態異常，請聯絡管理員確認。");
    }
  }

  async function handleFailure(failure: unknown) {
    const apiError = failure instanceof DeleteUserApiError ? failure : await toDeleteUserError(failure);
    if (classifyFailure(apiError) === "preview-changed") {
      // The summary no longer matches the database: drop the confirmation and fetch a fresh preview.
      setConfirmName(""); setStuck(null); setError(apiError.message);
      if (apiError.preview) setPreview(apiError.preview);
      const sequence = ++requestSequence.current;
      await loadPreview(targetId, sequence);
      return;
    }
    // Unknown outcomes (network, timeout, AUTH_DELETE_PENDING, DELETE_STATE_UNKNOWN, 404 on a retry, ...) never pick a
    // branch by themselves: the status action decides, and if it cannot answer either, nothing is assumed.
    if (requiresStatusCheck(apiError, stuck !== null || needsStatusCheck)) { await resolveByStatus(); return; }
    setError(apiError.message);
  }

  async function submit() {
    if (!preview || deleting) return;
    onStart?.();
    setDeleting(true); setError(null);
    try {
      if (needsStatusCheck) { await resolveByStatus(); return; }
      const retryingCleaned = stuck === "cleaned";
      try {
        await call(retryingCleaned ? { action: "delete", targetId, retry: true } : {
          action: "delete", targetId, confirmName, cutoffDate: preview.cutoffDate,
          futureCount: preview.futureCount, futureDayoffCount: preview.futureDayoffCount, retainedCount: preview.retainedCount,
        });
      } catch (failure) { await handleFailure(failure); return; }
      await finishDeleted();
    } finally { setDeleting(false); }
  }

  const retryingCleaned = stuck === "cleaned";
  const buttonLabel = deleting ? "處理中…" : needsStatusCheck ? "重新查詢" : retryingCleaned ? "重試完成刪除" : stuck === "uncleaned" ? "重試刪除" : "刪除使用者";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) onClose(); }}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-slate-950">刪除使用者</h2><p className="mt-1 text-sm text-slate-500">只能刪除 user 或 viewer。今天與過去的歷史資料會保留。</p></div><button type="button" onClick={onClose} disabled={deleting} aria-label="關閉" className="text-slate-400 hover:text-slate-700">✕</button></div>
        {refreshFailed ? (
          <>
            <div role="alert" className="mt-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{REFRESH_FAILED_MESSAGE}</div>
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">關閉</button><button type="button" onClick={() => window.location.reload()} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">重新整理頁面</button></div>
          </>
        ) : (
          <>
            <label className="mt-5 block text-sm font-semibold text-slate-700">帳號</label>
            <select value={targetId} onChange={(e) => void selectTarget(e.target.value)} disabled={loading || deleting} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">請選擇帳號</option>{targets.map((target) => <option key={target.id} value={target.id}>{formatMemberName(target.name)} · {target.role}</option>)}
            </select>
            {loading ? <p className="mt-4 text-sm text-slate-500">載入中…</p> : null}
            {preview ? <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>將刪除未來排班：{preview.futureCount} 筆（其中休假 {preview.futureDayoffCount} 筆）</p><p>將保留今天與過去：{preview.retainedCount} 筆</p><p className="mt-1 text-xs">截止日：{preview.cutoffDate}（Asia/Seoul）</p></div> : null}
            {preview && !retryingCleaned && !needsStatusCheck ? <><p className="mt-4 text-xs text-slate-500">請原樣輸入下方紅框內的文字（與資料庫中的名稱完全一致，不會自動轉成首字母大寫）：</p><label data-testid="confirm-text" className="mt-1 block break-all rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-sm font-semibold text-red-800">輸入「<span data-testid="confirm-name" className="select-all">{preview.confirmName}</span>」確認</label><input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={deleting} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></> : null}
            {error ? <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={deleting} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">取消</button><button type="button" onClick={() => void submit()} disabled={!preview || deleting || (!retryingCleaned && !needsStatusCheck && confirmName !== preview.confirmName)} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-red-300">{buttonLabel}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
