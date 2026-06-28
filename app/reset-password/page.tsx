"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setIsLoading(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace("/login");
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
            <h1 className="text-xl font-bold text-[#d4e4fa]">Set new password</h1>
            <p className="text-sm text-[#8c90a1]">Your new password must be at least 8 characters.</p>
          </div>
        </div>

        <label className="block text-sm font-medium text-[#d4e4fa] mb-2" htmlFor="password">
          New Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-[#424655]/50 bg-[#0d1c2d] px-3 py-2.5 text-[#d4e4fa] outline-none focus:border-[#b0c6ff]/50"
          required
          minLength={8}
        />

        <label className="block text-sm font-medium text-[#d4e4fa] mb-2" htmlFor="confirm">
          Confirm Password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
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
          {isLoading ? "Updating..." : "Update password"}
        </button>
      </form>
    </main>
  );
}
