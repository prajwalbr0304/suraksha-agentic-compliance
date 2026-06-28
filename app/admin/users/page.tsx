"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, GlassCard, StatusBadge } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/loading-states";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { usePrincipal } from "@/hooks/use-principal";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { toast } from "sonner";
import { Pencil, Plus, UserX, X } from "lucide-react";

interface OrgUser {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  department: string | null;
  team_id: string | null;
  status: string;
}

interface TeamRow {
  id: string;
  name: string;
}

const ASSIGNABLE_ROLES = [
  "bank_manager",
  "compliance_admin",
  "compliance_analyst",
  "security_team",
  "it_owner",
  "department_owner",
  "internal_auditor",
  "executive_viewer",
  "external_auditor",
];
const EMPTY = { email: "", password: "", full_name: "", role: "compliance_analyst", department: "", team_id: "" };

type EditFormState = {
  full_name: string;
  department: string;
  team_id: string;
  status: "active" | "suspended";
  email: string;
  password: string;
};

const EDIT_EMPTY: EditFormState = {
  full_name: "",
  department: "",
  team_id: "",
  status: "active",
  email: "",
  password: "",
};

export default function AdminUsersPage() {
  const api = useTenantApi();
  const { principal } = usePrincipal();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [editUser, setEditUser] = useState<OrgUser | null>(null);
  const [editForm, setEditForm] = useState(EDIT_EMPTY);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, d, t] = await Promise.all([
        api("/api/admin/users"),
        api("/api/admin/departments"),
        api("/api/admin/teams"),
      ]);
      if (!u.ok) {
        const b = await u.json().catch(() => ({}));
        throw new Error(b.error || "Failed to load users");
      }
      setUsers(await u.json());
      if (d.ok) setDepts(((await d.json()) as { name: string }[]).map((x) => x.name));
      if (t.ok) setTeams(await t.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (editUser) {
      setEditForm({
        full_name: editUser.full_name ?? "",
        department: editUser.department ?? "",
        team_id: editUser.team_id ?? "",
        status: editUser.status === "suspended" ? "suspended" : "active",
        email: editUser.email ?? "",
        password: "",
      });
    }
  }, [editUser]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const setEdit = (k: keyof EditFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditForm((p) => ({ ...p, [k]: e.target.value }));

  const teamLabel = (id: string | null) => (id ? teams.find((x) => x.id === id)?.name ?? "—" : "—");

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          full_name: form.full_name || undefined,
          role: form.role,
          department: form.department || null,
          team_id: form.team_id || null,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Failed");
      toast.success(`User ${form.email} created`);
      setForm(EMPTY);
      setShowCreate(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(u: OrgUser, role: string) {
    const res = await api(`/api/admin/users/${u.user_id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    const b = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success("Role updated");
      load();
    } else {
      toast.error(typeof b.error === "string" ? b.error : "Update failed");
    }
  }

  async function saveUserEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    const isSelf = !!(principal?.userId && principal.userId === editUser.user_id);
    const isFounder = !!principal?.isFounder;
    const isBankManagerSelf = isSelf && !isFounder && principal?.role === "bank_manager";
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (!isBankManagerSelf) {
        payload.department = editForm.department || null;
        payload.team_id = editForm.team_id || null;
        payload.full_name = editForm.full_name.trim() || null;
      }
      if (!isSelf) payload.status = editForm.status;

      if (isFounder && editUser.role === "bank_manager") {
        const nextEmail = editForm.email.trim();
        const curEmail = (editUser.email || "").trim();
        if (nextEmail.length > 0 && nextEmail.toLowerCase() !== curEmail.toLowerCase()) {
          payload.email = nextEmail;
        }
        const pw = editForm.password.trim();
        if (pw.length > 0) payload.password = pw;
      }

      const res = await api(`/api/admin/users/${editUser.user_id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof b.error === "string" ? b.error : "Update failed");
      toast.success("User updated");
      setEditUser(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(u: OrgUser) {
    const res = await api(`/api/admin/users/${u.user_id}`, { method: "DELETE" });
    const b = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success("User deactivated");
      load();
    } else {
      toast.error(typeof b.error === "string" ? b.error : "Failed");
    }
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="User Management" description="Create users, assign roles and departments within your bank." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Create users, assign roles and departments within your bank."
        actions={
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New User
          </button>
        }
      />

      {showCreate && (
        <GlassCard className="p-6">
          <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[#8c90a1]">Email *</label>
              <Input type="email" value={form.email} onChange={set("email")} required className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Temp Password *</label>
              <Input type="text" value={form.password} onChange={set("password")} required className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Full Name</label>
              <Input value={form.full_name} onChange={set("full_name")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Role</label>
              <select value={form.role} onChange={set("role")} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2">
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Department</label>
              <select value={form.department} onChange={set("department")} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2">
                <option value="">(none)</option>
                {depts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#8c90a1]">Team</label>
              <select value={form.team_id} onChange={set("team_id")} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2">
                <option value="">(none)</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm text-[#8c90a1]">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-60">
                {busy ? "Creating…" : "Create User"}
              </button>
            </div>
          </form>
        </GlassCard>
      )}

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-[#d4e4fa]">Users ({users.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#8c90a1] border-b border-white/[0.06]">
                <th className="text-left px-5 py-3">User</th>
                <th className="text-left px-3 py-3">Role</th>
                <th className="text-left px-3 py-3">Department / Team</th>
                <th className="text-center px-3 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = !!(principal?.userId && principal.userId === u.user_id);
                return (
                  <tr key={u.user_id} className="border-b border-white/[0.03] hover:bg-[#273647]/15">
                    <td className="px-5 py-3 text-[#d4e4fa]">
                      <span className="inline-flex items-center gap-2">
                        {u.full_name || u.email}
                        {isSelf && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8c90a1] border border-white/[0.08] rounded px-1.5 py-0.5">
                            You
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-[#8c90a1]">{u.email}</span>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={u.role}
                        disabled={isSelf}
                        title={isSelf ? "You cannot change your own role here" : undefined}
                        onChange={(e) => updateRole(u, e.target.value)}
                        className="rounded bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-xs px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-[#8c90a1]">
                      <span className="text-[#d4e4fa]">{u.department ?? "—"}</span>
                      {u.team_id && (
                        <span className="block text-[11px] text-[#8c90a1] mt-0.5">Team: {teamLabel(u.team_id)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <StatusBadge status={u.status} variant={u.status === "active" ? "success" : "error"} />
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        title="Edit user"
                        onClick={() => setEditUser(u)}
                        className="inline-flex items-center gap-1 text-xs text-[#8c90a1] hover:text-[#b0c6ff] mr-3"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      {u.status === "active" && !isSelf && (
                        <button
                          type="button"
                          onClick={() => deactivate(u)}
                          className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                        >
                          <UserX className="w-3.5 h-3.5" /> Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-[#8c90a1]">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {editUser && (() => {
        const editIsSelf = !!(principal?.userId && principal.userId === editUser.user_id);
        const isFounder = !!principal?.isFounder;
        const showFounderManagerLogin = isFounder && editUser.role === "bank_manager";
        const lockBankManagerSelf = editIsSelf && !isFounder && principal?.role === "bank_manager";
        const blockOwnName = lockBankManagerSelf;
        const founderLoginDirty =
          isFounder &&
          editUser.role === "bank_manager" &&
          (editForm.email.trim().toLowerCase() !== (editUser.email || "").trim().toLowerCase() ||
            editForm.password.trim().length > 0);
        const saveDisabled = busy || (lockBankManagerSelf && !founderLoginDirty);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="w-full max-w-lg p-6 relative border border-white/[0.1]">
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 text-[#8c90a1] hover:text-[#d4e4fa]"
              onClick={() => setEditUser(null)}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-semibold text-[#d4e4fa] mb-1">Edit user</h3>
            <p className="text-xs text-[#8c90a1] mb-4">{editUser.email}</p>
            <form onSubmit={saveUserEdit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {blockOwnName ? (
                <div className="md:col-span-2 rounded-lg border border-white/[0.06] bg-[#0d1c2d]/50 px-3 py-2.5 text-xs text-[#8c90a1]">
                  Display name cannot be changed on your own bank manager account here. A platform founder can update it if needed.
                  <span className="block text-sm text-[#d4e4fa] mt-1.5 font-medium">
                    {editUser.full_name || editUser.email || "—"}
                  </span>
                </div>
              ) : (
                <div className="md:col-span-2">
                  <label className="text-xs text-[#8c90a1]">Full name</label>
                  <Input value={editForm.full_name} onChange={setEdit("full_name")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                </div>
              )}
              {lockBankManagerSelf && (
                <div className="md:col-span-2 rounded-lg border border-white/[0.06] bg-[#0d1c2d]/50 px-3 py-2.5 text-xs text-[#8c90a1]">
                  Department and team are assigned for your bank manager account. A platform founder can change them if needed.
                  <span className="block text-sm text-[#d4e4fa] mt-1.5">
                    <span className="font-medium">Department:</span> {editUser.department ?? "—"}
                    <span className="mx-2 text-[#424655]">·</span>
                    <span className="font-medium">Team:</span> {teamLabel(editUser.team_id)}
                  </span>
                </div>
              )}
              {showFounderManagerLogin && (
                <>
                  <div className="md:col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100/90">
                    Founder: update this bank manager&apos;s <strong>login email</strong> and/or set a <strong>new password</strong> (min 8 characters). Leave password blank to keep the current password.
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-[#8c90a1]">Login email</label>
                    <Input
                      type="email"
                      autoComplete="off"
                      value={editForm.email}
                      onChange={setEdit("email")}
                      className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-[#8c90a1]">New password (optional)</label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={editForm.password}
                      onChange={setEdit("password")}
                      placeholder="Leave blank to keep current"
                      className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
                    />
                  </div>
                </>
              )}
              {!lockBankManagerSelf && (
                <>
                  <div>
                    <label className="text-xs text-[#8c90a1]">Department</label>
                    <select
                      value={editForm.department}
                      onChange={setEdit("department")}
                      className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2"
                    >
                      <option value="">(none)</option>
                      {depts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[#8c90a1]">Team</label>
                    <select
                      value={editForm.team_id}
                      onChange={setEdit("team_id")}
                      className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2"
                    >
                      <option value="">(none)</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="md:col-span-2">
                <label className="text-xs text-[#8c90a1]">Status</label>
                <select
                  value={editForm.status}
                  onChange={setEdit("status")}
                  disabled={!!(principal?.userId && principal.userId === editUser.user_id)}
                  title={
                    principal?.userId === editUser.user_id ? "You cannot change your own status here" : undefined
                  }
                  className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 disabled:opacity-50"
                >
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditUser(null)} className="px-4 py-2 text-sm text-[#8c90a1]">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveDisabled}
                  className="px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </GlassCard>
        </div>
        );
      })()}
    </div>
  );
}
