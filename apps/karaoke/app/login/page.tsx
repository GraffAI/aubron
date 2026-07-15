import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { createSessionValue, isAuthEnabled, passcode, SESSION_COOKIE } from "../lib/auth";

// Auth state is a runtime env var — never bake this page in at build time.
export const dynamic = "force-dynamic";

async function login(formData: FormData): Promise<void> {
  "use server";
  const attempt = formData.get("passcode");
  const expected = passcode();
  if (!expected || typeof attempt !== "string" || attempt !== expected) {
    redirect("/login?error=1");
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isAuthEnabled()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="font-display text-4xl tracking-tight">
          aubron <span className="text-neon">karaoke</span>
        </h1>
        <p className="mt-2 text-sm text-white/40">
          Private library — singers only past this point.
        </p>
      </div>
      <form action={login} className="flex w-full max-w-xs flex-col gap-3">
        <input
          type="password"
          name="passcode"
          placeholder="Passcode"
          autoFocus
          required
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center outline-none focus:border-neon/60"
        />
        {error ? (
          <p className="text-center text-sm text-red-400">That's not it — try again.</p>
        ) : null}
        <button
          type="submit"
          className="rounded-xl bg-neon px-4 py-3 font-medium text-black transition hover:brightness-110"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
