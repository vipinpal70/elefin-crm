import { SignJWT, jwtVerify } from "jose";

/**
 * Stateless session token (HS256 JWT in an HTTP-only cookie).
 * This module is Edge-safe — it must stay free of `next/headers`, Mongoose and
 * bcrypt so `middleware.ts` can import it.
 */

export const SESSION_COOKIE = "elefin_session";

export type Role = "owner" | "analyst" | "viewer";

export interface SessionUser {
  sub: string; // CrmUser _id
  email: string;
  name: string;
  role: Role;
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set to at least 16 characters.");
  }
  return new TextEncoder().encode(s);
}

export function sessionTtlHours(): number {
  const n = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${sessionTtlHours()}h`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    const role = payload.role;
    return {
      sub: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      role: role === "owner" || role === "analyst" ? role : "viewer",
    };
  } catch {
    return null;
  }
}
