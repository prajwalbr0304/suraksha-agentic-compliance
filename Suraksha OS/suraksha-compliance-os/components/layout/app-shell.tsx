"use client";

import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { supabase } from "@/lib/supabase/client";
import { allNavigationItems } from "@/data/mock-data";
import { authFetch } from "@/lib/auth/client";
import type { RequestPrincipal } from "@/lib/auth/permissions";
import { getTenantDashboardHomeHref, getTenantPathRedirect, navigationHrefMatches } from "@/lib/auth/tenant-routes";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname?.startsWith("/login");
  // Public marketing/auth routes render without the dashboard chrome or a session gate.
  const isPublic = isLogin || pathname === "/";
  const [isCheckingSession, setIsCheckingSession] = useState(!isPublic);
  const [principal, setPrincipal] = useState<RequestPrincipal | null>(null);

  useEffect(() => {
    let active = true;

    if (isPublic) {
      setIsCheckingSession(false);
      return () => {
        active = false;
      };
    }

    supabase.auth.getSession().then(async ({ data }) => {
      try {
        if (!active) return;
        if (!data.session) {
          router.replace("/login");
          return;
        }
        const res = await authFetch("/api/me");
        if (!active) return;
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        setPrincipal(await res.json());
        setIsCheckingSession(false);
      } catch {
        if (!active) return;
        router.replace("/login");
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && !isPublic) {
        router.replace("/login");
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [isPublic, router]);

  useLayoutEffect(() => {
    if (isPublic || isCheckingSession || !principal) return;
    const next = getTenantPathRedirect(pathname, principal);
    if (next) router.replace(next);
  }, [isPublic, isCheckingSession, principal, pathname, router]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#051424] flex items-center justify-center">
        <div className="rounded-xl border border-white/[0.08] bg-[#122131]/80 px-5 py-4 text-sm text-[#d4e4fa]">
          Checking secure session...
        </div>
      </div>
    );
  }

  const currentNav = allNavigationItems.find((item) => navigationHrefMatches(pathname, item.href, principal));
  if (currentNav?.personas && principal && !principal.isFounder && !currentNav.personas.includes(principal.role)) {
    return (
      <div className="min-h-screen bg-[#051424] flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-white/[0.08] bg-[#122131]/80 p-6 text-center">
          <h1 className="text-lg font-semibold text-[#d4e4fa]">Access denied</h1>
          <p className="mt-2 text-sm text-[#8c90a1]">Your current role cannot access this page.</p>
          <button
            onClick={() => router.replace(principal ? getTenantDashboardHomeHref(principal) : "/dashboard")}
            className="mt-4 rounded-lg bg-[#b0c6ff] px-4 py-2 text-sm font-semibold text-[#002d6f]"
          >
            Go to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#051424]">
      <Sidebar />
      <motion.div
        animate={{ marginLeft: collapsed ? 72 : 256 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="flex min-h-screen min-w-0 flex-1 flex-col"
      >
        <TopNav />
        <main className="flex-1 min-w-0 overflow-y-auto p-6 lg:p-8">{children}</main>
      </motion.div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarProvider>
  );
}
