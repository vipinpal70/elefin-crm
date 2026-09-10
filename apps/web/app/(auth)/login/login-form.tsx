"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initial: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form
      action={action}
      className="rounded-xl border border-rule bg-raised p-6 shadow-card"
    >
      <h1 className="text-sm font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-[13px] text-ink-2">
        Use the account provisioned for you.
      </p>

      <input type="hidden" name="next" value={next} />

      <label className="mt-4 block text-[13px] font-medium text-ink-2">
        Email
        <Input
          className="mt-1"
          type="email"
          name="email"
          autoComplete="username"
          required
          autoFocus
        />
      </label>

      <label className="mt-3 block text-[13px] font-medium text-ink-2">
        Password
        <Input
          className="mt-1"
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>

      {state.error ? (
        <p className="mt-3 rounded-md border border-err/30 bg-err-bg px-3 py-2 text-[13px] text-err">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="mt-4 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
