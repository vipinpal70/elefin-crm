"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { establishSession, verifyCredentials } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    await audit(null, "auth.login_failed", { meta: { email: parsed.data.email } });
    return { error: "Invalid email or password." };
  }

  await establishSession(user);
  await audit(user.sub, "auth.login", { entity: "user", entityId: user.sub });

  const dest =
    parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/";
  redirect(dest);
}
