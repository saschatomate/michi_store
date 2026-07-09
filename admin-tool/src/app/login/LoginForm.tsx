"use client";

import { useActionState } from "react";
import { login } from "@/lib/auth-actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form
        action={action}
        className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">Marinell Admin</h1>
        <p className="mb-6 text-sm text-neutral-500">Bitte Passwort eingeben.</p>

        <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">
          Passwort
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          className="mb-4 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />

        {state?.error && <p className="mb-4 text-sm text-red-600">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
