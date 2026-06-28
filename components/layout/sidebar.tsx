"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { founderNavigationItems, navigationItems } from "@/data/mock-data";
import { useSidebar } from "./sidebar-context";
import { usePrincipal } from "@/hooks/use-principal";
import { getTenantDashboardHomeHref, navigationHrefMatches, withTenantWorkspaceHref } from "@/lib/auth/tenant-routes";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Upload,
  Scale,
  GitBranch,
  ScrollText,
  BarChart3,
  Settings,
  ChevronLeft,
  Shield,
  FolderOpen,
  FileBarChart,
  Network,
  GitCompare,
  ShieldCheck,
  FileSearch,
  Zap,
  AlertTriangle,
  Crown,
  Users,
  UsersRound,
  Building2,
  KeyRound,
  Bot,
  ClipboardList,
  Landmark,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  Upload,
  Scale,
  GitBranch,
  ScrollText,
  BarChart3,
  Settings,
  FolderOpen,
  FileBarChart,
  Network,
  GitCompare,
  ShieldCheck,
  Shield,
  FileSearch,
  Zap,
  AlertTriangle,
  Crown,
  Users,
  UsersRound,
  Building2,
  KeyRound,
  Bot,
  ClipboardList,
  Landmark,
};

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, setCollapsed } = useSidebar();
  const { principal } = usePrincipal();
  const role = principal?.role;
  const isFounder = !!principal?.isFounder;
  const visibleItems = isFounder
    ? founderNavigationItems
    : navigationItems.filter((item) => !item.personas || (role && item.personas.includes(role)));

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 256 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={cn(
        "fixed left-0 top-0 h-screen z-50 flex flex-col",
        "bg-[#051424]/90 backdrop-blur-xl border-r border-white/[0.06]"
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.06]">
        <div className="w-9 h-9 rounded-lg bg-[#568dff]/20 flex items-center justify-center border border-[#568dff]/30 shrink-0">
          <Shield className="w-5 h-5 text-[#b0c6ff]" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
            >
              <h1 className="font-bold text-[#b0c6ff] text-lg leading-none tracking-tight">
                Suraksha OS
              </h1>
              <p className="text-[10px] uppercase tracking-[0.05em] text-[#8c90a1] mt-0.5 font-semibold">
                AI Compliance
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = iconMap[item.icon];
          const resolvedHref =
            item.href === "/founder" || !principal || isFounder
              ? item.href
              : item.href === "/dashboard"
                ? getTenantDashboardHomeHref(principal)
                : withTenantWorkspaceHref(item.href, principal);
          const isActive = navigationHrefMatches(pathname, item.href, principal);

          return (
            <Link
              key={item.href}
              href={resolvedHref}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group relative",
                isActive
                  ? "bg-[#b0c6ff]/10 text-[#b0c6ff]"
                  : "text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/30"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#b0c6ff] rounded-l-full"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              {Icon && (
                <Icon
                  className={cn(
                    "w-5 h-5 shrink-0 transition-colors",
                    isActive ? "text-[#b0c6ff]" : "group-hover:text-[#b0c6ff]"
                  )}
                />
              )}
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "text-sm font-medium",
                      isActive && "font-semibold"
                    )}
                  >
                    {item.title}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}
      </nav>

      {/* Collapse Button */}
      <div className="px-2 py-3 border-t border-white/[0.06]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 rounded-lg text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/30 transition-colors"
        >
          <motion.div
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronLeft className="w-5 h-5" />
          </motion.div>
        </button>
      </div>
    </motion.aside>
  );
}
