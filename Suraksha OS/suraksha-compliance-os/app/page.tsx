"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import type { ReactNode } from "react";
import {
  Shield,
  ArrowRight,
  Radar,
  Scale,
  Building2,
  ShieldCheck,
  Network,
  FileText,
  GitCompare,
  BarChart3,
  Lock,
  Sparkles,
  Workflow,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

/* ----------------------------------------------------------------------------
 * Suraksha OS — landing / starting page
 * Agentic Regulatory Intelligence & Compliance for Indian banking.
 * -------------------------------------------------------------------------- */

function Reveal({
  children,
  delay = 0,
  y = 24,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const LOOP = [
  {
    icon: Radar,
    step: "01",
    title: "Monitor",
    desc: "Agents continuously watch RBI, SEBI & PMLA feeds, detecting new circulars and downloading source PDFs.",
    color: "#3b82f6",
  },
  {
    icon: Scale,
    step: "02",
    title: "Translate",
    desc: "Each circular is parsed into discrete obligations and converted into Measurable Action Points (MAPs).",
    color: "#a855f7",
  },
  {
    icon: Building2,
    step: "03",
    title: "Assign",
    desc: "Every MAP is routed to the right bank department and owner, with priority and due dates.",
    color: "#22c55e",
  },
  {
    icon: ShieldCheck,
    step: "04",
    title: "Validate",
    desc: "Evidence is collected and completion is autonomously validated, feeding a live readiness score.",
    color: "#06b6d4",
  },
];

const FEATURES = [
  {
    icon: FileText,
    title: "AI Document Extraction",
    desc: "Parse RBI, SEBI & PMLA circulars and master directions automatically — no manual reading.",
    span: "lg:col-span-2",
  },
  {
    icon: Network,
    title: "Compliance Knowledge Graph",
    desc: "See the full chain: regulation → obligation → MAP → department → owner → evidence.",
    span: "",
  },
  {
    icon: GitCompare,
    title: "Regulatory Change Analysis",
    desc: "Diff circular versions and surface exactly what changed and who it impacts.",
    span: "",
  },
  {
    icon: BarChart3,
    title: "Risk & Readiness Analytics",
    desc: "Real-time department risk scores, audit readiness and trends across the institution.",
    span: "lg:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Evidence & Audit Trail",
    desc: "Every action is logged and evidence-backed for examiners.",
    span: "",
  },
  {
    icon: Lock,
    title: "Bank-grade Security",
    desc: "Multi-tenant isolation with RBAC, ABAC and Postgres Row-Level Security enforced end to end.",
    span: "lg:col-span-2",
  },
];

const STATS = [
  { value: "8", label: "Specialized AI agents" },
  { value: "4-stage", label: "Autonomous loop" },
  { value: "RBI · SEBI · PMLA", label: "Regulator coverage" },
  { value: "Postgres RLS", label: "Tenant isolation" },
];

export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#020a16] text-white antialiased">
      {/* ---- ambient background ---- */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-[#04101f] via-[#020a16] to-[#020912]" />
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.35, 0.55, 0.35] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-40 -left-40 h-[620px] w-[620px] rounded-full bg-[#1a3a6b]/30 blur-[140px]"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.25, 0.45, 0.25] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute top-1/3 -right-40 h-[560px] w-[560px] rounded-full bg-[#2d1b69]/30 blur-[140px]"
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#b0c6ff 1px, transparent 1px), linear-gradient(90deg, #b0c6ff 1px, transparent 1px)",
            backgroundSize: "46px 46px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
          }}
        />
      </div>

      {/* ---- nav ---- */}
      <header className="relative z-20">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-xl bg-[#b0c6ff]/20 blur-lg" />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#b0c6ff]/20 bg-gradient-to-br from-[#1a3560]/80 to-[#0d2040]/80">
                <Shield className="h-5 w-5 text-[#b0c6ff]" />
              </div>
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight">Suraksha OS</p>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#568dff]">AI Compliance</p>
            </div>
          </div>

          <div className="hidden items-center gap-8 text-sm text-[#8c99b8] md:flex">
            <a href="#loop" className="transition-colors hover:text-white">How it works</a>
            <a href="#features" className="transition-colors hover:text-white">Platform</a>
            <a href="#security" className="transition-colors hover:text-white">Security</a>
          </div>

          <Link
            href="/login"
            className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2 text-sm font-medium text-[#d4e4fa] backdrop-blur transition-all hover:border-[#b0c6ff]/40 hover:bg-white/[0.08]"
          >
            Sign in
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </nav>
      </header>

      {/* ---- hero ---- */}
      <section ref={heroRef} className="relative z-10">
        <motion.div style={{ y: heroY, opacity: heroOpacity }} className="mx-auto max-w-7xl px-6 pb-20 pt-16 lg:pt-24">
          <div className="mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#b0c6ff]/20 bg-[#b0c6ff]/[0.06] px-4 py-1.5 text-xs font-medium text-[#b0c6ff]"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Agentic Regulatory Intelligence &amp; Compliance
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.05 }}
              className="text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
              style={{ fontFamily: "var(--font-manrope)" }}
            >
              Compliance that
              <br />
              <span className="bg-gradient-to-r from-[#b0c6ff] via-[#7aa2ff] to-[#568dff] bg-clip-text text-transparent">
                runs itself.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 }}
              className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-[#8c99b8]"
            >
              Suraksha OS is an agentic platform that monitors regulatory change, translates it into
              Measurable Action Points, assigns them to the right bank departments, and autonomously
              validates completion — built for RBI, SEBI &amp; PMLA.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.25 }}
              className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Link
                href="/login"
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-[#2c5ae9] to-[#4270f5] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_8px_32px_-8px_rgba(66,112,245,0.6)] transition-all hover:shadow-[0_8px_40px_-6px_rgba(86,141,255,0.7)] sm:w-auto"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Launch workspace
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
                <div className="absolute inset-0 -translate-x-full bg-white/15 transition-transform duration-500 group-hover:translate-x-0" />
              </Link>
              <a
                href="#loop"
                className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-7 py-3.5 text-sm font-medium text-[#d4e4fa] backdrop-blur transition-all hover:border-white/20 hover:bg-white/[0.06] sm:w-auto"
              >
                See how it works
                <ChevronRight className="h-4 w-4" />
              </a>
            </motion.div>

            {/* trust row */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="mt-12 flex flex-wrap items-center justify-center gap-x-3 gap-y-2"
            >
              <span className="text-xs text-[#465268]">Built for</span>
              {["RBI", "SEBI", "PMLA", "BASEL"].map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#7e8aa6]"
                >
                  {t}
                </span>
              ))}
            </motion.div>
          </div>

          {/* hero visual — live agentic loop card */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.35, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="mx-auto mt-16 max-w-5xl"
          >
            <div className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-2 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] backdrop-blur">
              <div className="rounded-[20px] border border-white/[0.06] bg-[#050f1e]/80 p-6 sm:p-8">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#8c99b8]">
                    <Workflow className="h-4 w-4 text-[#b0c6ff]" />
                    Autonomous compliance loop
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    Live
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {LOOP.map((s, i) => (
                    <motion.div
                      key={s.title}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.6 + i * 0.12 }}
                      className="group relative rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-colors hover:border-white/15"
                    >
                      <div
                        className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg"
                        style={{ background: s.color + "1f", border: `1px solid ${s.color}40` }}
                      >
                        <s.icon style={{ color: s.color, width: 18, height: 18 }} />
                      </div>
                      <p className="text-[10px] font-bold tracking-widest text-[#465268]">{s.step}</p>
                      <p className="mt-0.5 text-sm font-semibold text-[#e3edff]">{s.title}</p>
                      {i < LOOP.length - 1 ? (
                        <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-white/15 lg:block" />
                      ) : null}
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ---- stats band ---- */}
      <section className="relative z-10 border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-6 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.08} className="px-4 py-8 text-center">
              <p
                className="bg-gradient-to-b from-white to-[#9fb4d8] bg-clip-text text-2xl font-bold text-transparent sm:text-3xl"
                style={{ fontFamily: "var(--font-manrope)" }}
              >
                {s.value}
              </p>
              <p className="mt-1.5 text-xs text-[#6b7a9a]">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- agentic loop detail ---- */}
      <section id="loop" className="relative z-10 mx-auto max-w-7xl px-6 py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#568dff]">The agentic loop</p>
          <h2
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-manrope)" }}
          >
            From circular to closed-out, automatically.
          </h2>
          <p className="mt-4 text-[#8c99b8]">
            A coordinator dispatches specialized agents across the entire compliance lifecycle — you stay in
            control with approvals at every gate.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {LOOP.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.1}>
              <div className="group h-full rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 transition-all hover:-translate-y-1 hover:border-white/15 hover:bg-white/[0.04]">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ background: s.color + "1f", border: `1px solid ${s.color}40` }}
                >
                  <s.icon className="h-5 w-5" style={{ color: s.color }} />
                </div>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="text-[11px] font-bold tracking-widest text-[#465268]">{s.step}</span>
                  <h3 className="text-lg font-semibold text-[#e3edff]">{s.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#8c99b8]">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- features bento ---- */}
      <section id="features" className="relative z-10 mx-auto max-w-7xl px-6 py-12 pb-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#568dff]">One platform</p>
          <h2
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--font-manrope)" }}
          >
            Everything compliance teams need.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.08} className={f.span}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 transition-all hover:border-[#b0c6ff]/25 hover:bg-white/[0.04]">
                <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#b0c6ff]/[0.05] blur-2xl transition-opacity group-hover:opacity-100" />
                <div className="relative">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#b0c6ff]/20 bg-[#b0c6ff]/[0.08]">
                    <f.icon className="h-5 w-5 text-[#b0c6ff]" />
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-[#e3edff]">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#8c99b8]">{f.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- security strip ---- */}
      <section id="security" className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#0a1d35] to-[#050f1e] p-8 sm:p-12">
            <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#2c5ae9]/20 blur-[100px]" />
            <div className="relative grid gap-8 lg:grid-cols-2 lg:items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#b0c6ff]/20 bg-[#b0c6ff]/[0.06] px-3 py-1 text-xs font-medium text-[#b0c6ff]">
                  <Lock className="h-3.5 w-3.5" />
                  Bank-grade by default
                </div>
                <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl" style={{ fontFamily: "var(--font-manrope)" }}>
                  Security woven into every layer.
                </h2>
                <p className="mt-3 max-w-md text-[#8c99b8]">
                  Multi-tenant isolation, role- and attribute-based access control, and Postgres
                  Row-Level Security — every query is scoped, every action audit-logged.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  "Row-Level Security (RLS)",
                  "RBAC + ABAC policies",
                  "Tenant data isolation",
                  "Full audit trail",
                  "Evidence-backed approvals",
                  "Encrypted in transit",
                ].map((t) => (
                  <div
                    key={t}
                    className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-sm text-[#d4e4fa]"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ---- final CTA ---- */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-28 text-center">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl" style={{ fontFamily: "var(--font-manrope)" }}>
            Let the agents handle the
            <span className="bg-gradient-to-r from-[#b0c6ff] to-[#568dff] bg-clip-text text-transparent"> busywork.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[#8c99b8]">
            Sign in to your compliance workspace and watch regulatory change turn into tracked,
            owned, and validated action.
          </p>
          <Link
            href="/login"
            className="group mt-9 inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-[#2c5ae9] to-[#4270f5] px-8 py-4 text-sm font-semibold text-white shadow-[0_8px_32px_-8px_rgba(66,112,245,0.6)] transition-all hover:shadow-[0_8px_44px_-6px_rgba(86,141,255,0.75)]"
          >
            Launch workspace
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </section>

      {/* ---- footer ---- */}
      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#b0c6ff]/20 bg-[#b0c6ff]/[0.08]">
              <Shield className="h-3.5 w-3.5 text-[#b0c6ff]" />
            </div>
            <span className="text-sm text-[#8c99b8]">
              Suraksha OS — AI Compliance Operating System
            </span>
          </div>
          <p className="text-xs text-[#465268]">
            Built for Indian banking institutions · {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
