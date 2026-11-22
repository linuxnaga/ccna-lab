import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signIn, signUp } from "./actions";

type Search = { mode?: string; error?: string; notice?: string; next?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { mode, error, notice, next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next ?? "/dashboard");

  const isSignup = mode === "signup";
  const input =
    "w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none";

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-6 glow-cyan">
        <p className="font-mono text-xs text-emerald-400">{isSignup ? "> enable new-operator" : "> login"}</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">{isSignup ? "Create your account" : "Sign in"}</h1>

        {notice === "check-email" && (
          <p className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            Check your email for a confirmation link, then sign in.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        <form action={isSignup ? signUp : signIn} className="mt-5 space-y-3">
          <input type="hidden" name="next" value={next ?? "/dashboard"} />
          {isSignup && (
            <label className="block text-sm text-slate-300">
              Display name
              <input name="display_name" autoComplete="nickname" className={`mt-1 ${input}`} placeholder="packet_whisperer" />
            </label>
          )}
          <label className="block text-sm text-slate-300">
            Email
            <input name="email" type="email" required autoComplete="email" className={`mt-1 ${input}`} />
          </label>
          <label className="block text-sm text-slate-300">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={isSignup ? "new-password" : "current-password"}
              className={`mt-1 ${input}`}
            />
          </label>
          <button className="w-full rounded-md bg-cyan-500 py-2 font-medium text-slate-950 hover:bg-cyan-400">
            {isSignup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-400">
          {isSignup ? "Already have an account? " : "New here? "}
          <Link href={isSignup ? "/login" : "/login?mode=signup"} className="text-cyan-300 hover:underline">
            {isSignup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </div>
  );
}
