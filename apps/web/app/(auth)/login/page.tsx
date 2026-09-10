import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Elefin Partner CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-ground px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-solid text-sm font-bold text-white shadow-[0_1px_2px_rgba(17,17,26,0.16)]">
            E
          </span>
          <span className="text-base font-semibold tracking-tight">
            Elefin Partner CRM
          </span>
        </div>
        <LoginForm next={typeof next === "string" ? next : ""} />
      </div>
    </main>
  );
}
