"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";
import { toast } from "sonner";
import { Pencil, X } from "lucide-react";

interface Bank {
  id: string;
  name: string;
  slug: string;
  status: string;
  manager_email: string | null;
  users: number;
  departments: number;
  obligations: number;
  compliance_score: number;
}

export default function FounderOrganizationOverviewPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [bank, setBank] = useState<Bank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editManagerOpen, setEditManagerOpen] = useState(false);
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [managerPassword2, setManagerPassword2] = useState("");
  const [managerFullName, setManagerFullName] = useState("");
  const [savingManager, setSavingManager] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/founder/banks");
      if (!res.ok) throw new Error("Failed to load banks");
      const banks = (await res.json()) as Bank[];
      const b = banks.find((x) => x.id === orgId);
      if (!b) throw new Error("Bank not found");
      setBank(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  function openEditManager() {
    if (!bank) return;
    setManagerEmail("");
    setManagerPassword("");
    setManagerPassword2("");
    setManagerFullName("");
    setEditManagerOpen(true);
  }

  async function saveManagerCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    const emailTrim = managerEmail.trim();
    const pwd = managerPassword.trim();
    const pwd2 = managerPassword2.trim();
    const nameTrim = managerFullName.trim();

    if (pwd || pwd2) {
      if (!pwd || !pwd2) {
        toast.error("Enter and confirm the new password.");
        return;
      }
      if (pwd.length < 8) {
        toast.error("Password must be at least 8 characters.");
        return;
      }
      if (pwd !== pwd2) {
        toast.error("Passwords do not match.");
        return;
      }
    }

    const payload: Record<string, unknown> = { organization_id: orgId };
    if (emailTrim && emailTrim !== (bank?.manager_email ?? "")) {
      payload.manager_email = emailTrim;
    }
    if (pwd) {
      payload.manager_password = pwd;
    }
    if (managerFullName.trim().length > 0) {
      payload.manager_full_name = managerFullName.trim();
    }

    if (Object.keys(payload).length === 1) {
      toast.error("Enter a new email, password, and/or display name to save.");
      return;
    }

    setSavingManager(true);
    try {
      const res = await authFetch("/api/founder/banks", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Update failed");
      toast.success("Bank manager updated.");
      setEditManagerOpen(false);
      setManagerEmail("");
      setManagerPassword("");
      setManagerPassword2("");
      setManagerFullName("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingManager(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="Tenant snapshot" />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  if (!bank && loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description="Loading…" />
      </div>
    );
  }

  if (!bank) return null;

  const openObl = bank.obligations;
  const score = bank.compliance_score;

  return (
    <div className="space-y-6">
      <PageHeader title={`${bank.name}`} description="High-level compliance posture for this bank." />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard className="p-5">
          <p className="text-xs text-[#8c90a1] uppercase tracking-wide">Compliance score</p>
          <p className="text-3xl font-bold text-[#d4e4fa] mt-1">{score}%</p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="text-xs text-[#8c90a1] uppercase tracking-wide">Open obligations</p>
          <p className="text-3xl font-bold text-[#d4e4fa] mt-1">{openObl}</p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="text-xs text-[#8c90a1] uppercase tracking-wide">Users</p>
          <p className="text-3xl font-bold text-[#d4e4fa] mt-1">{bank.users}</p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="text-xs text-[#8c90a1] uppercase tracking-wide">Departments</p>
          <p className="text-3xl font-bold text-[#d4e4fa] mt-1">{bank.departments}</p>
        </GlassCard>
      </div>

      <GlassCard className="p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#d4e4fa]">Bank manager</p>
            <p className="text-sm text-[#8c90a1] mt-1 break-all">{bank.manager_email ?? "—"}</p>
          </div>
          <button
            type="button"
            onClick={openEditManager}
            className="inline-flex items-center gap-2 rounded-lg border border-[#424655]/40 bg-[#273647]/40 px-3 py-2 text-xs font-medium text-[#d4e4fa] hover:border-[#b0c6ff]/40 hover:bg-[#273647]/60 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 text-[#b0c6ff]" />
            Edit login &amp; password
          </button>
        </div>
        <p className="text-xs text-[#5a637a] pt-1">
          Use the tabs above for documents, MAP board, evidence, departments, teams, and users scoped to this tenant.
        </p>
        <Link href="/agents" className="inline-block text-xs text-[#b0c6ff] hover:underline pt-1">
          Run agents for this bank (set org context on the Agents page via bank session, or use API with org header).
        </Link>
      </GlassCard>

      {editManagerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <GlassCard className="w-full max-w-md p-6 relative border border-white/[0.1]">
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 text-[#8c90a1] hover:text-[#d4e4fa]"
              onClick={() => setEditManagerOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-sm font-semibold text-[#d4e4fa] mb-1">Edit bank manager</h3>
            <p className="text-xs text-[#8c90a1] mb-4">
              Current login: <span className="text-[#d4e4fa]">{bank.manager_email}</span>. Leave a field blank to leave it unchanged.
            </p>
            <form onSubmit={saveManagerCredentials} className="space-y-4">
              <div>
                <label className="text-xs text-[#8c90a1] block mb-1">New login email</label>
                <Input
                  type="email"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                  placeholder={bank.manager_email ?? "manager@bank.com"}
                  className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-xs text-[#8c90a1] block mb-1">New password (min 8 characters)</label>
                <Input
                  type="password"
                  value={managerPassword}
                  onChange={(e) => setManagerPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="text-xs text-[#8c90a1] block mb-1">Confirm new password</label>
                <Input
                  type="password"
                  value={managerPassword2}
                  onChange={(e) => setManagerPassword2(e.target.value)}
                  placeholder="••••••••"
                  className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="text-xs text-[#8c90a1] block mb-1">Display name (optional)</label>
                <Input
                  type="text"
                  value={managerFullName}
                  onChange={(e) => setManagerFullName(e.target.value)}
                  placeholder="Bank Manager"
                  className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditManagerOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-[#8c90a1] hover:text-[#d4e4fa]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingManager}
                  className="px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-medium disabled:opacity-50"
                >
                  {savingManager ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
