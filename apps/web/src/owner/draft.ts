import { useRef, useState } from "react";
import { changeKey, object, revision, validChange, type Change } from "./api";
import { uuid } from "../auth/api";

export type Edit = { change: Change; label: string; previous: string };
export type Packet = { id: string; expected: string; changes: Change[] };
export type Draft = {
  version: 1;
  owner: string;
  id: string;
  updated: number;
  revision: string;
  edits: Edit[];
  fields: Record<string, string>;
  packet: Packet | null;
};
const prefix = (owner: string) => `qubite.owner.draft.v1.${owner}.`;
const allowedField = (k: string) =>
  /^(budget\|[^|]{1,180}\|(usd_micro|requests|tokens)|invite_email|invite_ttl|invite_pending|model_name|model_module|model_expiry|budget_scope|budget_key|selected_user|tab|timezone|timeout)$/.test(
    k,
  );
function parse(text: string, owner: string): Draft | null {
  try {
    const d: unknown = JSON.parse(text);
    if (
      !object(d) ||
      d.version !== 1 ||
      d.owner !== owner ||
      typeof d.id !== "string" ||
      !uuid.test(d.id) ||
      !revision(d.revision) ||
      typeof d.updated !== "number" ||
      !Array.isArray(d.edits) ||
      d.edits.length > 64 ||
      !object(d.fields) ||
      Object.keys(d.fields).length > 256
    )
      return null;
    if (
      d.edits.some(
        (e) =>
          !object(e) ||
          !validChange(e.change) ||
          typeof e.label !== "string" ||
          e.label.length > 240 ||
          typeof e.previous !== "string" ||
          e.previous.length > 1000,
      )
    )
      return null;
    if (
      Object.entries(d.fields).some(
        ([k, v]) => !allowedField(k) || typeof v !== "string" || v.length > 320,
      )
    )
      return null;
    if (
      d.packet !== null &&
      (!object(d.packet) ||
        typeof d.packet.id !== "string" ||
        !uuid.test(d.packet.id) ||
        !revision(d.packet.expected) ||
        !Array.isArray(d.packet.changes) ||
        d.packet.changes.length > 64 ||
        !d.packet.changes.every(validChange))
    )
      return null;
    return d as Draft;
  } catch {
    return null;
  }
}
export function useDraft(owner: string) {
  const [error, setError] = useState("");
  const [initial] = useState(() => {
    let candidates: Draft[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith(prefix(owner))) {
          const s = localStorage.getItem(k);
          if (s && s.length < 200000) {
            const d = parse(s, owner);
            if (d) candidates.push(d);
          }
        }
      }
    } catch {
      /* Exposed on the first synchronous write, never pretend a save succeeded. */
    }
    candidates = candidates.sort((a, b) => b.updated - a.updated);
    return { source: candidates[0] || null, candidates };
  });
  const [draft, setDraft] = useState<Draft>(() =>
    initial.source
      ? { ...initial.source, id: crypto.randomUUID() }
      : {
          version: 1,
          owner,
          id: crypto.randomUUID(),
          updated: Date.now(),
          revision: "owner-1-1-1",
          edits: [],
          fields: {},
          packet: null,
        },
  );
  const current = useRef(draft),
    original = useRef<Draft | null>(initial.source);
  const [alternatives, setAlternatives] = useState(initial.candidates.slice(1));
  function write(next: Draft): boolean {
    current.current = { ...next, updated: Date.now() };
    setDraft(current.current);
    try {
      localStorage.setItem(
        prefix(owner) + next.id,
        JSON.stringify(current.current),
      );
      const old = original.current;
      if (old) {
        const saved = localStorage.getItem(prefix(owner) + old.id);
        if (saved === JSON.stringify(old))
          localStorage.removeItem(prefix(owner) + old.id);
        original.current = null;
      }
      setError("");
      return true;
    } catch {
      setError(
        "Браузер не сохранил черновик. Освободи место или скачай его копию. До восстановления записи отправка остановлена.",
      );
      return false;
    }
  }
  function update(fn: (d: Draft) => Draft) {
    return write(fn(current.current));
  }
  function field(k: string, v: string) {
    if (allowedField(k))
      update((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));
  }
  function edit(change: Change, label: string, previous: string, rev: string) {
    if (current.current.packet) return;
    update((d) => ({
      ...d,
      revision:
        d.edits.length ||
        Object.keys(d.fields).some((k) => k.startsWith("budget|"))
          ? d.revision
          : rev,
      edits: [
        ...d.edits.filter((e) => changeKey(e.change) !== changeKey(change)),
        { change, label, previous },
      ],
    }));
  }
  function clear() {
    const d = current.current;
    try {
      localStorage.removeItem(prefix(owner) + d.id);
      if (
        original.current &&
        localStorage.getItem(prefix(owner) + original.current.id) ===
          JSON.stringify(original.current)
      )
        localStorage.removeItem(prefix(owner) + original.current.id);
    } catch {
      setError("Не удалось удалить сохранённый черновик.");
      return;
    }
    original.current = null;
    const next = {
      ...d,
      id: crypto.randomUUID(),
      updated: Date.now(),
      edits: [],
      fields: {},
      packet: null,
    };
    current.current = next;
    setDraft(next);
    setError("");
  }
  function restore(other: Draft) {
    original.current = other;
    const next = { ...other, id: crypto.randomUUID() };
    current.current = next;
    setDraft(next);
    setAlternatives([]);
  }
  return {
    draft,
    current,
    error,
    update,
    field,
    edit,
    clear,
    restore,
    alternatives,
    restored: !!initial.source,
  };
}
