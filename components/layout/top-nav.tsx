"use client";

import { Bell, LogOut, Search, Settings } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { NotificationCenter, useNotificationCount } from "@/components/notifications";
import { supabase } from "@/lib/supabase/client";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { usePrincipal } from "@/hooks/use-principal";
import { getTenantDashboardHomeHref, withTenantWorkspaceHref } from "@/lib/auth/tenant-routes";
import { cn } from "@/lib/utils";

function initialsFromEmail(email: string | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0]?.trim() ?? "";
  const parts = local.split(/[._\s-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return local.slice(0, 2).toUpperCase() || "?";
}

export function TopNav() {
  const router = useRouter();
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = useNotificationCount();
  const { principal } = usePrincipal();
  const avatarInitials = initialsFromEmail(principal?.email);
  const tenantLabel =
    principal?.isFounder === true
      ? "Executive hub (all banks)"
      : (principal?.organizationName?.trim() || principal?.organizationSlug || "Tenant");

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <header className="sticky top-0 z-40 h-16 bg-[#051424]/80 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between px-6">
        {/* Search — opens command palette */}
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center gap-2 bg-[#122131] border border-[#424655]/30 hover:border-[#b0c6ff]/30 rounded-lg px-3 py-2 w-full transition-all duration-200 text-left"
          >
            <Search className="w-4 h-4 text-[#8c90a1] shrink-0" />
            <span className="text-sm text-[#8c90a1]/60 flex-1">Search obligations, MAPs...</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-[#8c90a1] bg-[#273647]/50 rounded border border-[#424655]/30">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Center Brand */}
        <div className="hidden lg:block absolute left-1/2 transform -translate-x-1/2">
          <span className="text-sm font-semibold text-[#d4e4fa]/80">
            Suraksha Compliance OS
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {principal && (
            <div className="hidden sm:flex flex-col items-end leading-tight mr-1 max-w-[220px]">
              <span className="text-xs font-semibold text-[#d4e4fa] truncate w-full text-right" title={tenantLabel}>
                {tenantLabel}
              </span>
              {!principal.isFounder && principal.organizationSlug ? (
                <span
                  className="text-[10px] text-[#8c90a1] font-mono truncate w-full text-right"
                  title={principal.organizationSlug}
                >
                  {principal.organizationSlug}
                </span>
              ) : null}
            </div>
          )}
          {principal && (
            <div
              className="hidden md:block rounded-lg border border-[#424655]/30 bg-[#122131] px-3 py-2 text-xs font-medium text-[#d4e4fa]"
              title="Current role"
            >
              {ROLE_LABELS[principal.role]}
            </div>
          )}

          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={() => setNotifOpen(p => !p)}
              className="relative p-2 rounded-lg text-[#8c90a1] hover:text-[#b0c6ff] hover:bg-[#273647]/30 transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-[#b0c6ff] text-[#002d6f] text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
          </div>

          <Link
            href={principal ? withTenantWorkspaceHref("/settings", principal) : "/settings"}
            className={cn(
              "p-2 rounded-lg text-[#8c90a1] hover:text-[#b0c6ff] hover:bg-[#273647]/30 transition-colors",
              !(principal?.isFounder || principal?.permissions.includes("settings.manage") || principal?.permissions.includes("admin.all")) && "hidden"
            )}
          >
            <Settings className="w-5 h-5" />
          </Link>
          <button
            onClick={signOut}
            className="p-2 rounded-lg text-[#8c90a1] hover:text-[#b0c6ff] hover:bg-[#273647]/30 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <Link
            href={principal ? getTenantDashboardHomeHref(principal) : "/dashboard"}
            className="ml-2 pl-3 border-l border-white/[0.06] flex items-center gap-2 min-w-0"
            title="Go to your dashboard home"
          >
            <div className="hidden md:flex flex-col items-end min-w-0 text-right">
              <span className="text-xs font-medium text-[#d4e4fa] truncate max-w-[140px]">
                {principal?.email?.split("@")[0] || "User"}
              </span>
              <span className="text-[10px] text-[#8c90a1] truncate max-w-[140px]">{principal?.email}</span>
            </div>
            <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-[#568dff] to-[#b0c6ff] flex items-center justify-center">
              <span className="text-xs font-bold text-[#002d6f]">{avatarInitials}</span>
            </div>
          </Link>
        </div>
      </header>
    </>
  );
}
