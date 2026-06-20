"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setIsLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <main className="min-h-screen bg-[#051424] flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#122131]/80 p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl bg-[#b0c6ff]/15 border border-[#b0c6ff]/30 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-[#b0c6ff]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#d4e4fa]">Reset your password</h1>
            <p className="text-sm text-[#8c90a1]">Enter your email and we will send a reset link.</p>
          </div>
        </div>

        {sent ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Check your inbox — if an account exists, a reset link was sent.
          </div>
        ) : (
          <>
            <label className="block text-sm font-medium text-[#d4e4fa] mb-2" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mb-5 w-full rounded-lg border border-[#424655]/50 bg-[#0d1c2d] px-3 py-2.5 text-[#d4e4fa] outline-none focus:border-[#b0c6ff]/50"
              required
            />

            {error && (
              <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-[#b0c6ff] px-4 py-2.5 font-semibold text-[#002d6f] hover:bg-[#b0c6ff]/90 disabled:opacity-60"
            >
              {isLoading ? "Sending..." : "Send reset link"}
            </button>
          </>
        )}

        <div className="mt-4 text-center">
          <Link href="/login" className="text-xs text-[#b0c6ff] hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </main>
  );
}
