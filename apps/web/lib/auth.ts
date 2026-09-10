import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { connect, CrmUser } from "@elefin/db";
import {
  SESSION_COOKIE,
  sessionTtlHours,
  signSession,
  verifySession,
  type Role,
  type SessionUser,
} from "./session";

/** Current session, or null. Safe to call from any server component / action. */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect("/");
  return session;
}

/** Verify email + password against `crm_users`. Constant-ish time on miss. */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  await connect();
  const user = await CrmUser.findOne({
    email: email.toLowerCase().trim(),
    isActive: true,
  })
    .select("+passwordHash")
    .lean();

  if (!user) {
    // Spend a hash comparison anyway so timing does not leak account existence.
    await bcrypt.compare(password, "$2a$12$0000000000000000000000000000000000000000000000000000");
    return null;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  await CrmUser.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  return {
    sub: String(user._id),
    email: user.email,
    name: user.name ?? "",
    role: user.role as Role,
  };
}

export async function establishSession(user: SessionUser): Promise<void> {
  const token = await signSession(user);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionTtlHours() * 3600,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
