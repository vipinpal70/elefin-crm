"use client";

import { useActionState } from "react";
import {
  createUser,
  changeOwnPassword,
  type FormState,
} from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const init: FormState = {};

function Msg({ state }: { state: FormState }) {
  if (state.error)
    return <p className="mt-2 text-[12px] text-err">{state.error}</p>;
  if (state.ok) return <p className="mt-2 text-[12px] text-ok">{state.ok}</p>;
  return null;
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUser, init);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        Email
        <Input name="email" type="email" required className="h-8 w-56" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        Name
        <Input name="name" className="h-8 w-40" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        Role
        <select
          name="role"
          defaultValue="analyst"
          className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-[13px] text-ink"
        >
          <option value="owner">owner</option>
          <option value="analyst">analyst</option>
          <option value="viewer">viewer</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        Temp password
        <Input name="password" type="text" minLength={8} required className="h-8 w-44" />
      </label>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create user"}
      </Button>
      <div className="w-full">
        <Msg state={state} />
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPassword, init);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        Current password
        <Input name="current" type="password" required className="h-8 w-52" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        New password
        <Input name="next" type="password" minLength={8} required className="h-8 w-52" />
      </label>
      <Button size="sm" variant="secondary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
      <div className="w-full">
        <Msg state={state} />
      </div>
    </form>
  );
}
