// supabase/functions/create-user/index.ts
// Admin-only user creation. Runs as a Supabase Edge Function (Deno) because
// creating an Auth user requires the service role key, which must never
// reach the browser bundle. This file only wires up the real Deno/Supabase
// clients and env vars; the actual request logic (admin check, validation,
// create + role-assignment with rollback on failure) lives in handler.ts,
// which has no Deno-specific syntax so it can be unit-tested under Node --
// see handler.test.mjs.

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCreateUser } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Outer error boundary: handleCreateUser already catches everything in
  // its own logic, but this guards the request-level plumbing around it
  // (env lookup, client construction, JSON parsing) too, so a caller only
  // ever gets a well-formed JSON/CORS response, never a raw crash.
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Server is missing Supabase configuration." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header." }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    // Client scoped to the caller's own JWT -- RLS applies, this cannot be
    // used to read or write anything the caller isn't already allowed to.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Only built after the request reaches here; the admin check inside
    // handleCreateUser runs against callerClient first. Held only for the
    // lifetime of this request -- never sent to or readable by the client.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { status, body: responseBody } = await handleCreateUser(
      callerClient,
      adminClient,
      body,
    );

    return jsonResponse(responseBody, status);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unexpected server error." },
      500,
    );
  }
});
