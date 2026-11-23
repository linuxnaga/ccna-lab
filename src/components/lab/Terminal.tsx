"use client";

import { useEffect, useRef, useState } from "react";

export interface TermLine {
  text: string;
  kind: "out" | "cmd" | "err" | "log";
}

export function Terminal({
  lines,
  prompt,
  history,
  onSubmit,
  onComplete,
  onInterrupt,
  title,
  focusKey,
}: {
  lines: TermLine[];
  prompt: string;
  history: string[];
  onSubmit: (line: string) => void;
  onComplete: (line: string) => string;
  onInterrupt: () => void;
  title: string;
  /** Changes whenever the console should grab focus again (e.g. a device was clicked). */
  focusKey?: number;
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [title, focusKey]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      onSubmit(value);
      setValue("");
      setCursor(null);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const i = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(i);
      setValue(history[i]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cursor === null) return;
      const i = cursor + 1;
      if (i >= history.length) {
        setCursor(null);
        setValue("");
      } else {
        setCursor(i);
        setValue(history[i]);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      setValue(onComplete(value));
    } else if (e.key === "?" ) {
      e.preventDefault();
      onSubmit(value + "?");
    } else if ((e.ctrlKey && (e.key === "z" || e.key === "c"))) {
      e.preventDefault();
      setValue("");
      onInterrupt();
    }
  }

  const color = { out: "text-slate-200", cmd: "text-cyan-200", err: "text-rose-300", log: "text-amber-300" };

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-700 bg-black/80" onClick={() => inputRef.current?.focus()}>
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <span className="ml-2 font-mono text-xs text-slate-400">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[13px] leading-5" aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className={`whitespace-pre-wrap break-words ${color[l.kind]}`}>{l.text || " "}</div>
        ))}
        <div className="flex">
          <span className="whitespace-pre text-emerald-300">{prompt}</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label={`${title} command line`}
            className="flex-1 bg-transparent text-cyan-100 caret-cyan-300 outline-none"
          />
        </div>
        <div ref={endRef} />
      </div>
    </div>
  );
}
