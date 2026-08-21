import { getSupabaseClient, getSupabaseConfigError } from "@/lib/supabaseClient";
import type { Json } from "@/types/database";

export type ActivityEventType = "login" | "create" | "update" | "delete";

type LogActivityArgs = {
  eventType: ActivityEventType;
  targetTable?: string | null;
  targetId?: string | null;
  detail?: Json | null;
};

// Fire-and-forget usage/activity logging. Never throws -- a logging failure
// must not block the login or edit action that triggered it. See the header
// comment in supabase/migration_20260821_activity_logs.sql for why this is a
// usage log, not a tamper-proof security audit trail.
export async function logActivity({
  eventType,
  targetTable = null,
  targetId = null,
  detail = null,
}: LogActivityArgs) {
  if (getSupabaseConfigError()) {
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return;
    }

    const { error } = await supabase.from("activity_logs").insert({
      user_id: userId,
      event_type: eventType,
      target_table: targetTable,
      target_id: targetId,
      detail,
    });

    if (error) {
      console.error("logActivity failed:", error.message);
    }
  } catch (err) {
    console.error("logActivity threw:", err);
  }
}
