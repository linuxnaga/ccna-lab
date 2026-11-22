/** Deterministic loading placeholders for request-time pages (no data, no clock). */
const bar = "animate-pulse rounded-md bg-slate-800/80";

export function CardSkeleton({ width = "max-w-sm" }: { width?: string }) {
  return (
    <div className={`mx-auto ${width} px-4 py-16`} aria-busy="true" aria-label="Loading">
      <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/80 p-6">
        <div className={`${bar} h-3 w-24`} />
        <div className={`${bar} h-7 w-48`} />
        <div className={`${bar} h-10 w-full`} />
        <div className={`${bar} h-10 w-full`} />
        <div className={`${bar} h-10 w-full`} />
      </div>
    </div>
  );
}

export function PricingSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16" aria-busy="true" aria-label="Loading">
      <div className={`${bar} mx-auto h-8 w-80`} />
      <div className={`${bar} mx-auto mt-3 h-4 w-96 max-w-full`} />
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-80 rounded-xl border border-slate-700 bg-slate-900/70 p-6">
            <div className={`${bar} h-4 w-16`} />
            <div className={`${bar} mt-3 h-8 w-24`} />
            <div className={`${bar} mt-6 h-4 w-3/4`} />
            <div className={`${bar} mt-2 h-4 w-2/3`} />
            <div className={`${bar} mt-2 h-4 w-1/2`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10" aria-busy="true" aria-label="Loading">
      <div className={`${bar} h-7 w-72`} />
      <div className={`${bar} mt-5 h-24 w-full`} />
      <div className="mt-8 h-96 rounded-xl border border-slate-700 bg-slate-900/50 p-6">
        <div className={`${bar} h-6 w-64`} />
        <div className="mt-6 space-y-4">
          {[0, 1, 2].map((i) => <div key={i} className={`${bar} h-16 w-full sm:w-1/2`} />)}
        </div>
      </div>
    </div>
  );
}

export function LabSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4" aria-busy="true" aria-label="Loading lab">
      <div className={`${bar} h-14 w-full`} />
      <div className={`${bar} mt-4 h-7 w-80`} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-4">
          <div className="aspect-[5/3] rounded-lg border border-slate-700 bg-slate-950/70" />
          <div className={`${bar} h-48 w-full`} />
        </div>
        <div className="h-[70vh] min-h-[420px] rounded-lg border border-slate-700 bg-black/80" />
      </div>
    </div>
  );
}
