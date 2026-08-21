// supabase/functions/create-user/handler.ts
// Pure request-handling logic for the create-user Edge Function, with no
// Deno-specific syntax (no "npm:" imports, no Deno.* calls) so it can be
// unit-tested directly under Node by injecting mock Supabase clients --
// see supabase/functions/create-user/handler.test.mjs. The Deno entrypoint
// (index.ts) only wires up the real clients and env vars, then delegates
// here.

export const ALLOWED_ROLES = ["admin", "user", "viewer"] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

export type CreateUserBody = {
  email?: string;
  password?: string;
  role?: string;
};

export type SupabaseLikeClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
    admin: {
      createUser: (args: {
        email: string;
        password: string;
        email_confirm: boolean;
      }) => Promise<{
        data: { user: { id: string; email: string | null } | null };
        error: { message: string } | null;
      }>;
      deleteUser: (
        userId: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => { single: () => Promise<{ data: unknown; error: unknown }> };
    };
    upsert: (
      values: Record<string, unknown>,
      options: { onConflict: string },
    ) => {
      select: (columns: string) => {
        single: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export type HandlerResult = { status: number; body: Record<string, unknown> };

function result(status: number, body: Record<string, unknown>): HandlerResult {
  return { status, body };
}

// Confirms the caller's JWT resolves to a signed-in user whose
// public.profiles row has role = 'admin'. This is the real security
// boundary -- it runs against the caller's own scoped client, so RLS
// still applies and this cannot be spoofed by hiding a button client-side.
export async function requireAdminCaller(
  callerClient: SupabaseLikeClient,
): Promise<{ id: string } | HandlerResult> {
  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser();

  if (callerError || !caller) {
    return result(401, { error: "Invalid or expired session." });
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();

  const profile = callerProfile as { role?: string } | null;
  if (profileError || profile?.role !== "admin") {
    return result(403, { error: "Admin role required." });
  }

  return caller;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCreateUserBody(
  rawBody: unknown,
): { email: string; password: string; role: AllowedRole } | HandlerResult {
  if (!isPlainObject(rawBody)) {
    return result(400, { error: "Request body must be a JSON object." });
  }

  const body = rawBody as CreateUserBody;
  const email = typeof body.email === "string" ? body.email.trim() : undefined;
  const password = typeof body.password === "string" ? body.password : undefined;
  const role = typeof body.role === "string" ? body.role : undefined;

  if (!email || !password) {
    return result(400, { error: "email and password are required." });
  }
  if (password.length < 6) {
    return result(400, { error: "password must be at least 6 characters." });
  }
  if (!role || !ALLOWED_ROLES.includes(role as AllowedRole)) {
    return result(400, {
      error: `role must be one of: ${ALLOWED_ROLES.join(", ")}`,
    });
  }

  return { email, password, role: role as AllowedRole };
}

// Creates the Auth user, then explicitly upserts its public.profiles row
// with the requested role -- rather than creating the Auth user and
// relying on the on_auth_user_created / handle_new_user() DB trigger
// (schema.sql) to have already inserted a role='user' row to update.
// That assumption held in earlier testing but was proven false against
// this project's actual production database (2026-08-21): newly created
// Auth users got no profiles row at all, silently. Upserting here makes
// this function self-sufficient regardless of whether that trigger is
// active, instead of depending on it.
//
// If the upsert doesn't confirm exactly one row written, the newly
// created Auth user is deleted as a compensating action so the overall
// operation leaves the system either fully created (auth user + correct
// profile + role) or fully rolled back (nothing created) -- never a
// stuck user with no profile, or the wrong role, that can't be recreated
// because the email is already taken. If even the compensating delete
// fails, the response says so explicitly with the user id, instead of
// implying a clean failure the caller could safely retry.
export async function createUserWithRole(
  adminClient: SupabaseLikeClient,
  args: { email: string; password: string; role: AllowedRole },
): Promise<HandlerResult> {
  const { data: created, error: createError } =
    await adminClient.auth.admin.createUser({
      email: args.email,
      password: args.password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    return result(400, { error: createError?.message || "Failed to create user." });
  }

  const userId = created.user.id;
  const displayName = args.email.split("@")[0];

  const { data: profileRow, error: profileError } = await adminClient
    .from("profiles")
    .upsert(
      { id: userId, email: args.email, display_name: displayName, role: args.role },
      { onConflict: "id" },
    )
    .select("id")
    .single();

  if (profileError || !profileRow) {
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      userId,
    );

    if (deleteError) {
      return result(500, {
        error:
          "User created but writing its profile failed, and automatic " +
          "cleanup also failed. Manual cleanup required.",
        userId,
        requestedRole: args.role,
      });
    }

    return result(500, {
      error: "Failed to set up the account's profile; the account was rolled back.",
    });
  }

  return result(200, { id: userId, email: created.user.email, role: args.role });
}

// Top-level entrypoint called by index.ts. Wrapped in a try/catch so that
// any unexpected exception anywhere in the flow (malformed input, a client
// method throwing instead of rejecting cleanly, etc.) still produces a
// well-formed JSON error response instead of crashing the Edge Function
// and losing the CORS headers index.ts would otherwise attach.
export async function handleCreateUser(
  callerClient: SupabaseLikeClient,
  adminClient: SupabaseLikeClient,
  body: unknown,
): Promise<HandlerResult> {
  try {
    const callerOrError = await requireAdminCaller(callerClient);
    if ("status" in callerOrError) {
      return callerOrError;
    }

    const parsedOrError = validateCreateUserBody(body);
    if ("status" in parsedOrError) {
      return parsedOrError;
    }

    return await createUserWithRole(adminClient, parsedOrError);
  } catch (err) {
    return result(500, {
      error: err instanceof Error ? err.message : "Unexpected server error.",
    });
  }
}
