"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Eye,
  EyeOff,
  ArrowRight,
  Lock,
  FileText,
  GitCompare,
  ShieldCheck,
  BarChart3,
  Scale,
  Network,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { getTenantPostLoginRoute } from "@/lib/auth/tenant-routes";

const FEATURES = [
  {
    icon: FileText,
    label: "AI Document Extraction",
    description: "Parse RBI, SEBI & PMLA circulars automatically",
  },
  {
    icon: Scale,
    label: "Obligation Management",
    description: "Track, assign & monitor every regulatory requirement",
  },
  {
    icon: GitCompare,
    label: "Regulatory Change Analysis",
    description: "Compare circular versions and detect changes",
  },
  {
    icon: ShieldCheck,
    label: "Evidence & Readiness",
    description: "Collect audit evidence and score compliance posture",
  },
  {
    icon: Network,
    label: "Knowledge Graph",
    description: "Visualize regulation → obligation → control relationships",
  },
  {
    icon: BarChart3,
    label: "Risk & Analytics",
    description: "Real-time department risk scores and trend analysis",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setIsLoading(false);
      return;
    }

    let path = "/dashboard";
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const principal = await res.json();
          path = getTenantPostLoginRoute(principal);
        }
      }
    } catch {
      path = "/dashboard";
    }

    setIsSuccess(true);
    setTimeout(() => {
      router.replace(path);
      router.refresh();
      setIsLoading(false);
    }, 450);
  }

  return (
    <div className="min-h-screen bg-[#020d1a] flex overflow-hidden">
      {/* Left — Brand Panel */}
      <div className="hidden lg:flex w-[52%] flex-col relative overflow-hidden">
        {/* Animated gradient bg */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#051424] via-[#0a1d35] to-[#020d1a]" />
          <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-[#1a3a6b]/20 rounded-full blur-[120px] -translate-x-1/3 -translate-y-1/3" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-[#2d1b69]/20 rounded-full blur-[100px] translate-x-1/3 translate-y-1/3" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-[#153a6e]/10 rounded-full blur-[80px]" />
        </div>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(#b0c6ff 1px, transparent 1px), linear-gradient(90deg, #b0c6ff 1px, transparent 1px)",
          backgroundSize: "40px 40px"
        }} />

        <div className="relative z-10 flex flex-col h-full p-12">
          {/* Logo and tagline */}
          <div className="flex items-center gap-4 mb-auto">
            <div className="relative">
              <div className="absolute inset-0 bg-[#b0c6ff]/20 rounded-2xl blur-xl" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1a3560]/80 to-[#0d2040]/80 border border-[#b0c6ff]/20 flex items-center justify-center">
                <Shield className="w-8 h-8 text-[#b0c6ff]" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Suraksha OS</h1>
              <p className="text-[11px] font-bold tracking-[0.2em] text-[#568dff] uppercase mt-0.5">
                AI Compliance Operating System
              </p>
            </div>
          </div>

          {/* Hero headline */}
          <div className="mt-16 mb-12">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-[2.75rem] font-bold text-white leading-[1.15] tracking-tight"
            >
              Banking compliance,
              <br />
              <span className="bg-gradient-to-r from-[#b0c6ff] to-[#568dff] bg-clip-text text-transparent">
                powered by AI.
              </span>
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="mt-4 text-[#6b7a9a] text-lg leading-relaxed max-w-md"
            >
              Built for Indian banking institutions. Ingest RBI, SEBI &amp; PMLA
              circulars, extract obligations automatically, and track audit
              readiness — all in one platform.
            </motion.p>
          </div>

          {/* Features grid */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="grid grid-cols-2 gap-3 mb-12"
          >
            {FEATURES.map(({ icon: Icon, label, description }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.35 + i * 0.07 }}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-[#b0c6ff]/10 border border-[#b0c6ff]/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[#b0c6ff]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#d4e4fa]">{label}</p>
                  <p className="text-[11px] text-[#5a637a] mt-0.5 leading-tight">{description}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* Bottom strip */}
          <div className="mt-auto pt-8 border-t border-white/[0.05] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-3 h-3 text-[#3d4a62]" />
              <span className="text-[11px] text-[#3d4a62]">
                RBAC + ABAC + Postgres RLS enforced
              </span>
            </div>
            <div className="flex items-center gap-1">
              {["RBI", "SEBI", "PMLA", "BASEL"].map((tag) => (
                <span key={tag} className="text-[10px] font-bold text-[#2a3450] border border-[#2a3450] rounded px-1.5 py-0.5">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right — Login Panel */}
      <div className="flex-1 flex items-center justify-center p-8 relative">
        {/* Subtle radial glow behind form */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[500px] h-[500px] bg-[#0d2a4e]/30 rounded-full blur-[100px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative w-full max-w-[420px]"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-[#b0c6ff]/10 border border-[#b0c6ff]/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-[#b0c6ff]" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">Suraksha OS</span>
              <p className="text-[10px] font-bold tracking-[0.18em] text-[#568dff] uppercase">AI Compliance</p>
            </div>
          </div>

          {/* Card */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#071525]/90 backdrop-blur-xl shadow-[0_32px_80px_-12px_rgba(0,0,0,0.7)] p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white">Welcome back</h2>
              <p className="text-[#6b7a9a] text-sm mt-1.5">
                Sign in to your compliance workspace
              </p>
            </div>

            <AnimatePresence mode="wait">
              {isSuccess ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center py-8 gap-4"
                >
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-white">Authenticated</p>
                    <p className="text-sm text-[#6b7a9a] mt-1">Redirecting to your dashboard…</p>
                  </div>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  onSubmit={submit}
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-5"
                >
                  {/* Email */}
                  <div>
                    <label className="block text-xs font-semibold text-[#8c99b8] uppercase tracking-[0.08em] mb-2" htmlFor="email">
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@yourbank.com"
                      className="w-full rounded-xl border border-[#1e2f4a] bg-[#0a1828] px-4 py-3 text-[#d4e4fa] text-sm placeholder:text-[#2e3d56] outline-none transition-all focus:border-[#b0c6ff]/50 focus:bg-[#0d1e32] focus:ring-1 focus:ring-[#b0c6ff]/20"
                      required
                      autoComplete="email"
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-[#8c99b8] uppercase tracking-[0.08em]" htmlFor="password">
                        Password
                      </label>
                      <a href="/forgot-password" className="text-xs text-[#568dff] hover:text-[#b0c6ff] transition-colors">
                        Forgot password?
                      </a>
                    </div>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full rounded-xl border border-[#1e2f4a] bg-[#0a1828] px-4 py-3 pr-11 text-[#d4e4fa] text-sm placeholder:text-[#2e3d56] outline-none transition-all focus:border-[#b0c6ff]/50 focus:bg-[#0d1e32] focus:ring-1 focus:ring-[#b0c6ff]/20"
                        required
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#3d4d65] hover:text-[#8c99b8] transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Error */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm text-red-300">
                          {error}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-[#2c5ae9] to-[#4270f5] px-4 py-3 text-sm font-semibold text-white transition-all hover:from-[#3566f5] hover:to-[#5580ff] hover:shadow-[0_0_24px_rgba(86,141,255,0.35)] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Signing in…
                        </>
                      ) : (
                        <>
                          Sign in to workspace
                          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </span>
                    <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-white/[0.07] transition-transform duration-500" />
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="mt-6 text-center space-y-2">
            <p className="text-[11px] text-[#2e3d56]">
              Contact your organization administrator for account access.
            </p>
            <div className="flex items-center justify-center gap-4 text-[11px] text-[#2e3d56]">
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3" />
                End-to-end encrypted
              </span>
              <span>·</span>
              <span>RBAC + RLS enforced</span>
              <span>·</span>
              <span>Audit-logged</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
