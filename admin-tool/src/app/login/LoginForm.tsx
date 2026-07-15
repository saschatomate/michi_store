"use client";

import { useActionState } from "react";
import { AlertCircle, Lock } from "lucide-react";
import { login } from "@/lib/auth-actions";
import { inputClass, buttonPrimary } from "@/lib/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#faf8f5] via-[#f5f2ed] to-[#efe9e1] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 font-display text-2xl font-semibold text-white shadow-md shadow-indigo-600/20">
            M
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-3xl font-semibold tracking-wide text-zinc-900">
              Marinell Admin
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">
              Produkt-Pipeline
            </span>
          </div>
        </div>

        <form action={action} className="rounded-2xl border border-zinc-200/80 bg-white p-8 shadow-lg shadow-zinc-300/30">
          <div className="mb-6 flex items-center gap-2 text-zinc-900">
            <Lock size={16} className="text-zinc-400" />
            <h1 className="text-sm font-semibold">Anmeldung erforderlich</h1>
          </div>

          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-zinc-700">
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            className={`${inputClass} mb-4`}
          />

          {state?.error && (
            <div className="mb-4 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <button type="submit" disabled={pending} className={`${buttonPrimary} w-full`}>
            {pending ? "Anmelden…" : "Anmelden"}
          </button>
        </form>
      </div>
    </div>
  );
}
