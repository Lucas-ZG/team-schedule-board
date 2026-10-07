import { createClient } from "npm:@supabase/supabase-js@2";
import { handleDeleteUser } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "伺服器設定不完整。" }, 500);
  if (!authHeader) return json({ error: "Missing Authorization header." }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const response = await handleDeleteUser(caller, admin, body);
  return json(response.body, response.status);
});
