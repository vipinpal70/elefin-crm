"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connect, CrmUser, AppConfig } from "@elefin/db";
import { ROLES } from "@elefin/db";
import { requireRole, requireSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export interface FormState {
  error?: string;
  ok?: string;
}

const roleEnum = z.enum(ROLES as unknown as [string, ...string[]]);

export async function createUser(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const owner = await requireRole("owner");
  const parsed = z
    .object({
      email: z.string().email(),
      name: z.string().trim().max(80).optional(),
      role: roleEnum,
      password: z.string().min(8).max(128),
    })
    .safeParse({
      email: fd.get("email"),
      name: fd.get("name") || undefined,
      role: fd.get("role"),
      password: fd.get("password"),
    });
  if (!parsed.success) return { error: "Check the fields — email + role + an 8-char password." };

  await connect();
  const email = parsed.data.email.toLowerCase().trim();
  if (await CrmUser.exists({ email })) return { error: "A user with that email already exists." };

  const user = await CrmUser.create({
    email,
    name: parsed.data.name ?? "",
    role: parsed.data.role,
    passwordHash: await hashPassword(parsed.data.password),
    isActive: true,
  });
  await audit(owner.sub, "user.create", {
    entity: "user",
    entityId: String(user._id),
    meta: { email, role: parsed.data.role },
  });
  revalidatePath("/settings");
  return { ok: `Created ${email}.` };
}

export async function setUserActive(userId: string, active: boolean): Promise<void> {
  const owner = await requireRole("owner");
  if (userId === owner.sub) return; // never lock yourself out
  await connect();
  await CrmUser.updateOne({ _id: userId }, { $set: { isActive: active } });
  await audit(owner.sub, active ? "user.enable" : "user.disable", {
    entity: "user",
    entityId: userId,
  });
  revalidatePath("/settings");
}

export async function resetUserPassword(fd: FormData): Promise<void> {
  const owner = await requireRole("owner");
  const userId = String(fd.get("userId") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) return;
  await connect();
  await CrmUser.updateOne(
    { _id: userId },
    { $set: { passwordHash: await hashPassword(password) } },
  );
  await audit(owner.sub, "user.reset_password", { entity: "user", entityId: userId });
  revalidatePath("/settings");
}

export async function changeOwnPassword(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const s = await requireSession();
  const parsed = z
    .object({ current: z.string().min(1), next: z.string().min(8).max(128) })
    .safeParse({ current: fd.get("current"), next: fd.get("next") });
  if (!parsed.success) return { error: "New password must be at least 8 characters." };

  const { verifyCredentials } = await import("@/lib/auth");
  const ok = await verifyCredentials(s.email, parsed.data.current);
  if (!ok) return { error: "Current password is wrong." };

  await connect();
  await CrmUser.updateOne(
    { _id: s.sub },
    { $set: { passwordHash: await hashPassword(parsed.data.next) } },
  );
  await audit(s.sub, "user.change_own_password", { entity: "user", entityId: s.sub });
  return { ok: "Password changed." };
}

export async function updateTargets(fd: FormData): Promise<void> {
  const owner = await requireRole("owner");
  const clean = (k: string) => {
    const n = Number(fd.get(k));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const data = {
    signups: clean("signups"),
    fundedClients: clean("fundedClients"),
    netDeposits: clean("netDeposits"),
  };
  await connect();
  await AppConfig.updateOne(
    { _id: "targets" },
    { $set: { data, updatedBy: owner.sub } },
    { upsert: true },
  );
  await audit(owner.sub, "config.targets", { entity: "config", entityId: "targets", meta: data });
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function updateAlertThresholds(fd: FormData): Promise<void> {
  const owner = await requireRole("owner");
  const data: Record<string, Record<string, number>> = {};
  for (const [k, v] of fd.entries()) {
    // field names are "type.key"
    const [type, key] = String(k).split(".");
    if (!type || !key) continue;
    const num = Number(v);
    if (!Number.isFinite(num)) continue;
    (data[type] ??= {})[key] = num;
  }
  await connect();
  await AppConfig.updateOne(
    { _id: "alerts" },
    { $set: { data, updatedBy: owner.sub } },
    { upsert: true },
  );
  await audit(owner.sub, "config.alert_thresholds", { entity: "config", entityId: "alerts", meta: data });
  revalidatePath("/settings");
}
