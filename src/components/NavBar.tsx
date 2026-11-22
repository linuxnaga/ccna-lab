import Link from "next/link";
import { connection } from "next/server";
import { Network } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/site";

export async function NavBar() {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-mono font-semibold text-cyan-300">
          <Network className="h-5 w-5" aria-hidden />
          {BRAND}
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="text-slate-300 hover:text-white">Pricing</Link>
          {user ? (
            <>
              <Link href="/dashboard" className="text-slate-300 hover:text-white">Dashboard</Link>
              <form action="/auth/signout" method="post">
                <button className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500 hover:text-white">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="rounded-md bg-cyan-500 px-3 py-1.5 font-medium text-slate-950 hover:bg-cyan-400">
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

/** Static placeholder shown while the signed-in state streams in. */
export function NavBarShell() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center px-4">
        <span className="flex items-center gap-2 font-mono font-semibold text-cyan-300">
          <Network className="h-5 w-5" aria-hidden />
          {BRAND}
        </span>
      </nav>
    </header>
  );
}
