/**
 * User administration helpers (server-only, service role).
 * Creates/updates Supabase auth users and their organization membership.
 */
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { SurakshaRole } from "@/lib/auth/permissions";

export interface CreateUserInput {
  email: string;
  password: string;
  fullName?: string;
  organizationId: string;
  role: SurakshaRole;
  department?: string | null;
  teamId?: string | null;
}

export interface CreatedUser {
  userId: string;
  email: string;
}

/**
 * Create (or reuse) an auth user, set their profile org, and add an
 * organization_members row. Idempotent on email within the org.
 */
export async function createOrgUser(input: CreateUserInput): Promise<CreatedUser> {
  const supabase = getSupabaseServerClient();

  // 1. Find existing auth user by email (admin list), else create.
  let userId: string | null = null;
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users?.find((u) => (u.email || "").toLowerCase() === input.email.toLowerCase());
  if (existing) {
    userId = existing.id;
  } else {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName ?? null },
    });
    if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = created.user.id;
  }

  // 2. Upsert profile (current org + name).
  await supabase.from("profiles").upsert(
    {
      id: userId,
      email: input.email,
      full_name: input.fullName ?? null,
      current_org_id: input.organizationId,
      default_persona: input.role,
    },
    { onConflict: "id" }
  );

  // 3. Upsert organization membership.
  await supabase.from("organization_members").upsert(
    {
      organization_id: input.organizationId,
      user_id: userId,
      role: input.role,
      department: input.department ?? null,
      team_id: input.teamId ?? null,
      status: "active",
    },
    { onConflict: "organization_id,user_id,role" }
  );

  return { userId: userId as string, email: input.email };
}

export interface UpdateBankManagerLoginInput {
  organizationId: string;
  /** Must be the org's active bank_manager user id. */
  userId: string;
  /** New login email (omit or empty to leave unchanged). */
  email?: string | null;
  /** New password (omit or empty to leave unchanged). Min 8 characters when set. */
  password?: string | null;
}

/**
 * Update bank manager **login email and/or password** for a specific user id.
 * Verifies the user is the active `bank_manager` for the organization, then
 * syncs `profiles.email` and `organizations.manager_email` when email changes.
 * (Used by platform founders drilling into a bank; not for self-service managers.)
 */
export async function updateBankManagerLoginCredentials(
  input: UpdateBankManagerLoginInput
): Promise<{ userId: string; email: string }> {
  const supabase = getSupabaseServerClient();

  const { data: row, error: rowErr } = await supabase
    .from("organization_members")
    .select("user_id, role, status")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (rowErr || !row?.user_id) {
    throw new Error("Member not found in this organization.");
  }
  if (row.role !== "bank_manager" || row.status !== "active") {
    throw new Error("Login email/password can only be changed here for the active bank manager.");
  }

  const userId = row.user_id;
  const emailTrim = typeof input.email === "string" ? input.email.trim() : "";
  const pwd = typeof input.password === "string" ? input.password.trim() : "";
  const updateEmail = emailTrim.length > 0;
  const updatePassword = pwd.length > 0;

  if (!updateEmail && !updatePassword) {
    throw new Error("Provide a new email and/or password to update.");
  }

  if (updatePassword && pwd.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  if (updateEmail) {
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const taken = list?.users?.some(
      (u) => u.id !== userId && (u.email || "").toLowerCase() === emailTrim.toLowerCase()
    );
    if (taken) {
      throw new Error("That email is already in use by another account.");
    }
  }

  const { data: existingUser, error: getErr } = await supabase.auth.admin.getUserById(userId);
  if (getErr || !existingUser?.user) {
    throw new Error(getErr?.message ?? "Manager account not found.");
  }

  const adminPayload: { email?: string; password?: string } = {};
  if (updateEmail) adminPayload.email = emailTrim;
  if (updatePassword) adminPayload.password = pwd;

  const { error: updErr } = await supabase.auth.admin.updateUserById(userId, adminPayload);
  if (updErr) throw new Error(updErr.message);

  const resolvedEmail = updateEmail ? emailTrim : (existingUser.user.email ?? "");

  if (updateEmail) {
    await supabase.from("profiles").update({ email: emailTrim, updated_at: new Date().toISOString() }).eq("id", userId);
    await supabase.from("organizations").update({ manager_email: emailTrim }).eq("id", input.organizationId);
  }

  return { userId, email: resolvedEmail };
}

export interface UpdateBankManagerInput {
  organizationId: string;
  /** New login email (omit or empty to leave unchanged). */
  email?: string | null;
  /** New password (omit or empty to leave unchanged). Min 8 characters when set. */
  password?: string | null;
  /** Display name; set to `""` to clear. Omit property entirely to leave unchanged. */
  fullName?: string;
}

/**
 * Update the **bank_manager** membership's auth user (email/password/metadata) and
 * sync `profiles` + `organizations.manager_email` when the login email changes.
 */
export async function updateBankManagerCredentials(input: UpdateBankManagerInput): Promise<{ userId: string; email: string }> {
  const supabase = getSupabaseServerClient();

  const { data: row, error: rowErr } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", input.organizationId)
    .eq("role", "bank_manager")
    .eq("status", "active")
    .maybeSingle();

  if (rowErr || !row?.user_id) {
    throw new Error("No active bank manager is assigned to this organization.");
  }

  const userId = row.user_id;
  const emailTrim = typeof input.email === "string" ? input.email.trim() : "";
  const pwd = typeof input.password === "string" ? input.password.trim() : "";
  const updateEmail = emailTrim.length > 0;
  const updatePassword = pwd.length > 0;
  const updateName = input.fullName !== undefined;

  if (!updateEmail && !updatePassword && !updateName) {
    throw new Error("Provide a new email, password, and/or full name to update.");
  }

  if (updatePassword && pwd.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  if (updateEmail) {
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const taken = list?.users?.some(
      (u) => u.id !== userId && (u.email || "").toLowerCase() === emailTrim.toLowerCase()
    );
    if (taken) {
      throw new Error("That email is already in use by another account.");
    }
  }

  const { data: existingUser, error: getErr } = await supabase.auth.admin.getUserById(userId);
  if (getErr || !existingUser?.user) {
    throw new Error(getErr?.message ?? "Manager account not found.");
  }

  const adminPayload: {
    email?: string;
    password?: string;
    user_metadata?: Record<string, unknown>;
  } = {};

  if (updateEmail) adminPayload.email = emailTrim;
  if (updatePassword) adminPayload.password = pwd;
  if (updateName) {
    adminPayload.user_metadata = {
      ...(existingUser.user.user_metadata ?? {}),
      full_name: input.fullName ?? "",
    };
  }

  if (Object.keys(adminPayload).length > 0) {
    const { error: updErr } = await supabase.auth.admin.updateUserById(userId, adminPayload);
    if (updErr) throw new Error(updErr.message);
  }

  const resolvedEmail = updateEmail ? emailTrim : (existingUser.user.email ?? "");

  if (updateEmail) {
    await supabase.from("profiles").update({ email: emailTrim, updated_at: new Date().toISOString() }).eq("id", userId);
    await supabase.from("organizations").update({ manager_email: emailTrim }).eq("id", input.organizationId);
  }

  if (updateName) {
    const fn = input.fullName ?? "";
    await supabase
      .from("profiles")
      .update({ full_name: fn || null, updated_at: new Date().toISOString() })
      .eq("id", userId);
  }

  return { userId, email: resolvedEmail };
}

/** Deactivate a user's membership in an org (soft) — they keep auth but lose access. */
export async function deactivateOrgUser(organizationId: string, userId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  await supabase
    .from("organization_members")
    .update({ status: "suspended", expires_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
}
