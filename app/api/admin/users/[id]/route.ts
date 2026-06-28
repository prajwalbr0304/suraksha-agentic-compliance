/**
 * Manager user administration for a single user (by user_id), org-scoped.
 *   PATCH  — update role/department/team/status, display name (profiles + auth metadata).
 *             Bank managers cannot change their own full name, department, team, or login email/password here;
 *             platform founders (with org context) may update the bank manager’s login email/password only.
 *   DELETE — deactivate membership
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission, ROLES, type SurakshaRole } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";
import { isFounderAccountId } from "@/lib/auth/founder-account";
import { deactivateOrgUser, updateBankManagerLoginCredentials } from "@/lib/services/user-admin.service";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "users.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!principal.isFounder && (await isFounderAccountId(supabase, id))) {
    return NextResponse.json({ error: "Cannot modify a platform founder account" }, { status: 403 });
  }

  const { data: existing, error: exErr } = await supabase
    .from("organization_members")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .eq("user_id", id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const isSelf = !!(principal.userId && id === principal.userId);
  const isBankManagerSelf = isSelf && !principal.isFounder && principal.role === "bank_manager";

  if (isBankManagerSelf) {
    if (body.full_name !== undefined) {
      return NextResponse.json(
        { error: "You cannot change your own display name here. Ask a platform founder to update it if needed." },
        { status: 403 }
      );
    }
    if (body.email !== undefined || body.password !== undefined) {
      return NextResponse.json(
        { error: "You cannot change your own login email or password here. Ask a platform founder to reset them if needed." },
        { status: 403 }
      );
    }
    if (body.department !== undefined) {
      const next =
        body.department === null || body.department === ""
          ? null
          : String(body.department).trim() || null;
      const cur = (existing.department as string | null) ?? null;
      if ((next ?? "") !== (cur ?? "")) {
        return NextResponse.json(
          {
            error:
              "You cannot change your own department here. Ask a platform founder if your assignment must change.",
          },
          { status: 403 }
        );
      }
    }
    if (body.team_id !== undefined) {
      const raw = body.team_id ? String(body.team_id) : null;
      const cur = (existing.team_id as string | null) ?? null;
      if ((raw ?? "") !== (cur ?? "")) {
        return NextResponse.json(
          {
            error: "You cannot change your own team here. Ask a platform founder if your assignment must change.",
          },
          { status: 403 }
        );
      }
    }
  }

  if (
    principal.userId &&
    id === principal.userId &&
    body.role !== undefined &&
    !principal.isFounder
  ) {
    return NextResponse.json({ error: "You cannot change your own role" }, { status: 403 });
  }

  if (
    principal.userId &&
    id === principal.userId &&
    body.status !== undefined &&
    String(body.status) === "suspended" &&
    !principal.isFounder
  ) {
    return NextResponse.json({ error: "You cannot suspend your own account" }, { status: 403 });
  }

  const loginFieldsRequested = body.email !== undefined || body.password !== undefined;
  if (loginFieldsRequested && !principal.isFounder) {
    return NextResponse.json(
      { error: "Only a platform founder can change another user's login email or password." },
      { status: 403 }
    );
  }

  let loginEmailUpdated = false;
  let loginPasswordUpdated = false;
  if (principal.isFounder && loginFieldsRequested) {
    if (existing.role !== "bank_manager") {
      return NextResponse.json(
        { error: "Login email and password can only be changed here for the bank manager account." },
        { status: 403 }
      );
    }
    const emailTrim = body.email !== undefined ? String(body.email ?? "").trim() : "";
    const pwdTrim = body.password !== undefined ? String(body.password ?? "").trim() : "";
    const hasNewEmail = body.email !== undefined && emailTrim.length > 0;
    const hasNewPassword = body.password !== undefined && pwdTrim.length > 0;
    if (hasNewEmail || hasNewPassword) {
      try {
        await updateBankManagerLoginCredentials({
          organizationId: principal.organizationId,
          userId: id,
          email: hasNewEmail ? emailTrim : undefined,
          password: hasNewPassword ? pwdTrim : undefined,
        });
        loginEmailUpdated = hasNewEmail;
        loginPasswordUpdated = hasNewPassword;
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Login update failed" }, { status: 400 });
      }
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.role !== undefined) {
    const role = String(body.role) as SurakshaRole;
    if (!ROLES.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    if (!principal.isFounder && (role === "founder" || role === "platform_admin")) {
      return NextResponse.json({ error: "Cannot assign founder/platform_admin" }, { status: 403 });
    }
    updates.role = role;
  }
  if (body.department !== undefined) {
    const dept = body.department ? String(body.department).trim() : null;
    if (dept) {
      const { data: deptRow } = await supabase
        .from("departments")
        .select("name")
        .eq("organization_id", principal.organizationId)
        .eq("name", dept)
        .maybeSingle();
      if (!deptRow) {
        return NextResponse.json({ error: "Department not found in this organization." }, { status: 400 });
      }
    }
    updates.department = dept;
  }
  if (body.team_id !== undefined) {
    const raw = body.team_id ? String(body.team_id) : null;
    if (raw) {
      const { data: teamRow } = await supabase
        .from("teams")
        .select("id")
        .eq("id", raw)
        .eq("organization_id", principal.organizationId)
        .maybeSingle();
      if (!teamRow) {
        return NextResponse.json({ error: "Team not found in this organization." }, { status: 400 });
      }
    }
    updates.team_id = raw;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["active", "suspended"].includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    updates.status = status;
  }

  const hasFullName = body.full_name !== undefined;
  const fullNameVal =
    hasFullName && body.full_name === null
      ? null
      : hasFullName
        ? String(body.full_name).trim() || null
        : undefined;

  if (Object.keys(updates).length === 0 && !hasFullName && !loginEmailUpdated && !loginPasswordUpdated) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  let data = existing;
  if (Object.keys(updates).length > 0) {
    const { data: updated, error } = await supabase
      .from("organization_members")
      .update(updates)
      .eq("organization_id", principal.organizationId)
      .eq("user_id", id)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    data = updated;
  }

  if (hasFullName) {
    const fn = fullNameVal;
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ full_name: fn, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

    const { data: authUser, error: gErr } = await supabase.auth.admin.getUserById(id);
    if (!gErr && authUser?.user) {
      await supabase.auth.admin.updateUserById(id, {
        user_metadata: {
          ...(authUser.user.user_metadata ?? {}),
          full_name: fn ?? "",
        },
      });
    }
  }

  const auditMeta: Record<string, unknown> = { ...updates };
  if (hasFullName) auditMeta.full_name = fullNameVal;
  if (loginEmailUpdated) auditMeta.manager_login_email_updated = true;
  if (loginPasswordUpdated) auditMeta.manager_login_password_updated = true;

  await writeAudit(supabase, principal, {
    action: updates.role !== undefined ? "role_assigned" : "user_updated",
    target: id,
    targetId: id,
    details: `Updated member ${id}: ${Object.keys(auditMeta).join(", ") || "profile"}`,
    metadata: auditMeta,
    organizationId: principal.organizationId,
  });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "users.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  const { id } = await params;
  const supabase = getSupabaseServerClient();

  if (principal.userId && id === principal.userId) {
    return NextResponse.json({ error: "You cannot deactivate your own account" }, { status: 403 });
  }
  if (!principal.isFounder && (await isFounderAccountId(supabase, id))) {
    return NextResponse.json({ error: "Cannot deactivate a platform founder account" }, { status: 403 });
  }

  await deactivateOrgUser(principal.organizationId, id);
  await writeAudit(supabase, principal, {
    action: "user_deactivated",
    target: id,
    targetId: id,
    details: `Deactivated member ${id}`,
    severity: "warning",
    organizationId: principal.organizationId,
  });
  return NextResponse.json({ success: true });
}
