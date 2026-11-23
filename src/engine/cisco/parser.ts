/**
 * IOS-style command matcher: unique-prefix keyword abbreviations ("conf t"),
 * typed arguments, "% Ambiguous", "% Incomplete" and '^' error markers.
 */
import type { Device } from "./model";
import { IFACE_TYPES } from "./model";
import { parseIp } from "./ip";

export type ArgType = "ip" | "int" | "iface" | "word" | "line";

type Elem = { kw: string } | { arg: ArgType; name: string };

export interface Token {
  text: string;
  col: number;
}

export type Args = Record<string, string | number>;

export interface Spec<C> {
  elems: Elem[];
  help: string;
  when?: (dev: Device, ctx: C) => boolean;
  run: (ctx: C, args: Args) => void;
}

/** Build a spec from a pattern like "ip address <ip:addr> <ip:mask>". */
export function spec<C>(pattern: string, help: string, run: Spec<C>["run"], when?: Spec<C>["when"]): Spec<C> {
  const elems: Elem[] = pattern.split(/\s+/).map((p) => {
    const m = /^<(\w+):(\w+)>$/.exec(p);
    return m ? { arg: m[1] as ArgType, name: m[2] } : { kw: p };
  });
  return { elems, help, run, when };
}

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) tokens.push({ text: m[0], col: m.index });
  return tokens;
}

/** Expand an interface reference like "g0/0", "gig 0/1", "fa0/5", "vlan 10". Returns [fullName, tokensConsumed]. */
export function matchIface(tokens: Token[], i: number, dev: Device): [string, number] | null {
  const t = tokens[i]?.text.toLowerCase();
  if (!t) return null;
  const m = /^([a-z]+)([\d/]*)$/.exec(t);
  if (!m) return null;
  const [, typePart, numPart] = m;
  const types = IFACE_TYPES.filter((ty) => ty.full.toLowerCase().startsWith(typePart));
  if (types.length !== 1) return null;
  const type = types[0];
  let num = numPart;
  let consumed = 1;
  if (!num) {
    const next = tokens[i + 1]?.text;
    if (!next || !/^[\d/]+$/.test(next)) return null;
    num = next;
    consumed = 2;
  }
  const name = type.full + num;
  if (dev.interfaces[name]) return [name, consumed];
  // SVIs are created on demand on switches.
  if (type.full === "Vlan" && dev.kind === "switch" && /^\d+$/.test(num) && +num >= 1 && +num <= 4094) {
    return [name, consumed];
  }
  if (type.full === "Loopback" && dev.kind === "router" && /^\d+$/.test(num) && +num <= 2147483647) {
    return [name, consumed];
  }
  return null;
}

function matchArg(type: ArgType, tokens: Token[], i: number, dev: Device): [string | number, number] | null {
  const t = tokens[i]?.text;
  if (t === undefined) return null;
  switch (type) {
    case "ip":
      return parseIp(t) !== null ? [t, 1] : null;
    case "int":
      return /^\d+$/.test(t) ? [Number(t), 1] : null;
    case "word":
      return [t, 1];
    case "line":
      return [tokens.slice(i).map((x) => x.text).join(" "), tokens.length - i];
    case "iface":
      return matchIface(tokens, i, dev);
  }
}

export type MatchResult<C> =
  | { kind: "ok"; spec: Spec<C>; args: Args; canonical: string }
  | { kind: "invalid"; col: number; tokenIndex: number }
  | { kind: "ambiguous"; token: string }
  | { kind: "incomplete" };

interface Live<C> {
  spec: Spec<C>;
  e: number;
  ti: number;
  args: Args;
  words: string[];
}

export function match<C>(specs: Spec<C>[], line: string, dev: Device): MatchResult<C> {
  const tokens = tokenize(line);
  let live: Live<C>[] = specs.map((s) => ({ spec: s, e: 0, ti: 0, args: {}, words: [] }));
  let furthestFail = 0;
  const done: Live<C>[] = [];

  while (live.length) {
    const ti = Math.min(...live.map((l) => l.ti));
    const group = live.filter((l) => l.ti === ti);
    const rest = live.filter((l) => l.ti !== ti);

    if (ti >= tokens.length) {
      done.push(...group.filter((l) => l.e === l.spec.elems.length));
      const incomplete = group.filter((l) => l.e < l.spec.elems.length);
      live = rest;
      if (!rest.length && !done.length && incomplete.length) return { kind: "incomplete" };
      continue;
    }

    const tok = tokens[ti].text.toLowerCase();
    // Keyword candidates at this position, for abbreviation / ambiguity handling.
    const kwHits = new Set<string>();
    for (const l of group) {
      const el = l.spec.elems[l.e];
      if (el && "kw" in el && el.kw.startsWith(tok)) kwHits.add(el.kw);
    }
    let chosenKw: string | null = null;
    if (kwHits.size === 1) chosenKw = [...kwHits][0];
    else if (kwHits.has(tok)) chosenKw = tok;
    else if (kwHits.size > 1) {
      const anyArg = group.some((l) => {
        const el = l.spec.elems[l.e];
        return el && "arg" in el && matchArg(el.arg, tokens, ti, dev);
      });
      if (!anyArg) return { kind: "ambiguous", token: tokens.slice(0, ti + 1).map((t) => t.text).join(" ") };
    }

    const next: Live<C>[] = [];
    for (const l of group) {
      const el = l.spec.elems[l.e];
      if (!el) continue;
      if ("kw" in el) {
        if (el.kw === chosenKw) next.push({ ...l, e: l.e + 1, ti: ti + 1, words: [...l.words, el.kw] });
      } else {
        const m = matchArg(el.arg, tokens, ti, dev);
        if (m) {
          const shown = `<${el.arg === "iface" ? "interface" : el.name}>`;
          next.push({ ...l, e: l.e + 1, ti: ti + m[1], args: { ...l.args, [el.name]: m[0] }, words: [...l.words, shown] });
        }
      }
    }
    if (!next.length) furthestFail = Math.max(furthestFail, ti);
    live = [...rest, ...next];
  }

  if (done.length) {
    // Prefer the spec declared first (specs are ordered by priority).
    done.sort((a, b) => specs.indexOf(a.spec) - specs.indexOf(b.spec));
    const best = done[0];
    return { kind: "ok", spec: best.spec, args: best.args, canonical: best.words.join(" ") };
  }
  const tok = tokens[furthestFail] ?? tokens[tokens.length - 1];
  return { kind: "invalid", col: tok?.col ?? 0, tokenIndex: furthestFail };
}

/** Keywords/args that could come next, for "?" help. */
export function nextOptions<C>(specs: Spec<C>[], line: string, dev: Device): { word: string; help: string }[] {
  const trailingSpace = /\s$/.test(line) || line === "";
  const tokens = tokenize(line);
  const partial = trailingSpace ? "" : (tokens.pop()?.text.toLowerCase() ?? "");
  const prefix = tokens.map((t) => t.text).join(" ");
  const out = new Map<string, string>();
  for (const s of specs) {
    // Does the prefix fully match the start of this spec?
    let ti = 0;
    let e = 0;
    let ok = true;
    while (ti < tokens.length && e < s.elems.length) {
      const el = s.elems[e];
      if ("kw" in el) {
        if (!el.kw.startsWith(tokens[ti].text.toLowerCase())) { ok = false; break; }
        ti++;
      } else {
        const m = matchArg(el.arg, tokens, ti, dev);
        if (!m) { ok = false; break; }
        ti += m[1];
      }
      e++;
    }
    if (!ok || ti !== tokens.length) continue;
    const el = s.elems[e];
    if (!el) { if (!partial) out.set("<cr>", ""); continue; }
    if ("kw" in el) {
      if (el.kw.startsWith(partial)) out.set(el.kw, e === s.elems.length - 1 || !out.has(el.kw) ? s.help : out.get(el.kw)!);
    } else if (!partial) {
      const label = el.arg === "ip" ? "A.B.C.D" : el.arg === "int" ? "<number>" : el.arg === "iface" ? "<interface>" : el.arg === "line" ? "LINE" : "WORD";
      out.set(label, el.name);
    }
  }
  void prefix;
  return [...out].map(([word, help]) => ({ word, help })).sort((a, b) => a.word.localeCompare(b.word));
}

/** Complete the last token if it uniquely abbreviates a keyword. */
export function completeLine<C>(specs: Spec<C>[], line: string, dev: Device): string {
  if (/\s$/.test(line) || !line.trim()) return line;
  const opts = nextOptions(specs, line, dev).filter((o) => /^[a-z-]+$/.test(o.word));
  if (opts.length !== 1) {
    // Interface type completion: "int g" -> "int GigabitEthernet"
    const last = tokenize(line).pop()!;
    const types = IFACE_TYPES.filter((t) => t.full.toLowerCase().startsWith(last.text.toLowerCase()));
    if (opts.length === 0 && types.length === 1 && /^[a-z]+$/i.test(last.text)) {
      return line.slice(0, last.col) + types[0].full;
    }
    return line;
  }
  const last = tokenize(line).pop()!;
  return line.slice(0, last.col) + opts[0].word + " ";
}
