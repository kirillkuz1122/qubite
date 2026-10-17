import { request, AuthFault, uuid } from "../auth/api";

export type Change = {
  kind: string;
  [key: string]: string | number | boolean | null;
};
export type OwnerState = {
  revision: string;
  timezone: string;
  timeout_seconds: number;
  now: string;
  reauth_until: string | null;
  registration: { mode: string; revision: number; consent_version: string };
  modules: {
    id: string;
    name: string;
    visibility: string;
    installed: boolean;
    enabled: boolean;
    released: boolean;
  }[];
};
export type User = {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  platform_owner: boolean;
  auth_version: number;
  verified_at: string | null;
  created_at: string;
};
export type Grant = {
  module: string;
  action: string;
  effect: string;
  expires_at: string | null;
};
export type ModelGrant = Omit<Grant, "action"> & {
  provider: string;
  model: string;
};
export type Detail = {
  revision: string;
  subject_id: string;
  grants: Grant[];
  models: ModelGrant[];
  more_models: boolean;
};
export type BudgetRow = {
  period: string;
  usd_micro: number | null;
  requests: number | null;
  tokens: number | null;
  spent_usd: number;
  reserved_usd: number;
  remaining_usd: number | null;
  spent_requests: number;
  reserved_requests: number;
  spent_tokens: number;
  reserved_tokens: number;
  ends_at: string | null;
  timezone: string;
};
export type Budget = {
  revision: string;
  scope: string;
  key: string;
  items: BudgetRow[];
  freezes: { provider: string; model: string }[];
};
export type Receipt = { id: string; revision: string; count: number };
export const base = "/api/v1/owner/console";
export const revision = (v: unknown): v is string =>
  typeof v === "string" &&
  /^owner-[1-9]\d{0,17}-[1-9]\d{0,17}-[1-9]\d{0,17}$/.test(v);
export function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
const string = (v: unknown, max = 320): v is string =>
  typeof v === "string" && v.length <= max;
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const date = (v: unknown) =>
  string(v, 64) &&
  /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
function guard(condition: unknown): asserts condition {
  if (!condition) throw new AuthFault("invalid_response");
}
function envelope(v: unknown): Record<string, unknown> {
  guard(object(v) && Object.keys(v).join() === "data" && object(v.data));
  return v.data;
}
export function parseState(v: unknown): OwnerState {
  const d = envelope(v);
  guard(
    revision(d.revision) &&
      string(d.timezone, 100) &&
      integer(d.timeout_seconds) &&
      (d.timeout_seconds as number) >= 1 &&
      (d.timeout_seconds as number) <= 300 &&
      date(d.now) &&
      nullableDate(d.reauth_until),
  );
  guard(
    object(d.registration) &&
      ["invite", "public", "disabled"].includes(
        d.registration.mode as string,
      ) &&
      integer(d.registration.revision) &&
      string(d.registration.consent_version, 80),
  );
  guard(Array.isArray(d.modules) && d.modules.length <= 64);
  const seen = new Set<string>();
  for (const m of d.modules) {
    guard(
      object(m) &&
        string(m.id, 32) &&
        /^[a-z][a-z0-9_]*$/.test(m.id) &&
        !seen.has(m.id) &&
        string(m.name, 160) &&
        ["locked", "hidden"].includes(m.visibility as string) &&
        [m.installed, m.enabled, m.released].every(
          (v) => typeof v === "boolean",
        ),
    );
    seen.add(m.id);
  }
  return d as OwnerState;
}
export function parseUsers(v: unknown): {
  revision: string;
  items: User[];
  next: string | null;
} {
  const d = envelope(v);
  guard(
    revision(d.revision) &&
      Array.isArray(d.items) &&
      d.items.length <= 30 &&
      (d.next === null || (string(d.next, 36) && uuid.test(d.next))),
  );
  for (const u of d.items)
    guard(
      object(u) &&
        string(u.id, 36) &&
        uuid.test(u.id) &&
        string(u.email) &&
        (u.display_name === null || string(u.display_name, 160)) &&
        ["pending", "active", "blocked"].includes(u.status as string) &&
        typeof u.platform_owner === "boolean" &&
        integer(u.auth_version) &&
        nullableDate(u.verified_at) &&
        date(u.created_at),
    );
  return d as { revision: string; items: User[]; next: string | null };
}
export function parseDetail(v: unknown): Detail {
  const d = envelope(v);
  guard(
    revision(d.revision) &&
      string(d.subject_id, 36) &&
      uuid.test(d.subject_id) &&
      Array.isArray(d.grants) &&
      d.grants.length <= 256 &&
      Array.isArray(d.models) &&
      d.models.length <= 128 &&
      typeof d.more_models === "boolean",
  );
  for (const g of [...d.grants, ...d.models])
    guard(
      object(g) &&
        string(g.module, 32) &&
        ["allow", "deny"].includes(g.effect as string) &&
        nullableDate(g.expires_at) &&
        ("action" in g
          ? ["read", "write", "manage", "ai"].includes(g.action as string)
          : string(g.provider, 48) && string(g.model, 96)),
    );
  return d as Detail;
}
export function parseBudget(v: unknown): Budget {
  const d = envelope(v);
  guard(
    revision(d.revision) &&
      string(d.scope, 16) &&
      string(d.key, 145) &&
      Array.isArray(d.items) &&
      d.items.length === 3 &&
      Array.isArray(d.freezes),
  );
  guard(new Set(d.items.map((r) => (object(r) ? r.period : null))).size === 3);
  for (const r of d.items)
    guard(
      object(r) &&
        ["day", "month", "all"].includes(r.period as string) &&
        ["usd_micro", "requests", "tokens", "remaining_usd"].every(
          (k) => r[k] === null || integer(r[k]),
        ) &&
        [
          "spent_usd",
          "reserved_usd",
          "spent_requests",
          "reserved_requests",
          "spent_tokens",
          "reserved_tokens",
        ].every((k) => integer(r[k])) &&
        nullableDate(r.ends_at) &&
        string(r.timezone, 100),
    );
  for (const f of d.freezes)
    guard(object(f) && string(f.provider, 48) && string(f.model, 96));
  return d as Budget;
}
export function parseReceipt(v: unknown): Receipt {
  guard(
    object(v) &&
      Object.keys(v).sort().join() === "count,id,revision" &&
      string(v.id, 36) &&
      uuid.test(v.id) &&
      revision(v.revision) &&
      integer(v.count),
  );
  return v as Receipt;
}
export function parseAudit(v: unknown): {
  items: {
    id: string;
    actor_id: string | null;
    source: string;
    changes: unknown[];
    created_at: string;
  }[];
  next: string | null;
} {
  const d = envelope(v);
  guard(
    Array.isArray(d.items) &&
      d.items.length <= 20 &&
      (d.next === null || (string(d.next, 36) && uuid.test(d.next))),
  );
  for (const e of d.items)
    guard(
      object(e) &&
        string(e.id, 36) &&
        uuid.test(e.id) &&
        (e.actor_id === null ||
          (string(e.actor_id, 36) && uuid.test(e.actor_id))) &&
        ["console", "policy", "budget", "registration"].includes(
          e.source as string,
        ) &&
        Array.isArray(e.changes) &&
        e.changes.length <= 64 &&
        date(e.created_at),
    );
  return d as ReturnType<typeof parseAudit>;
}
export async function metadata(
  path: string,
  signal: AbortSignal,
  body?: unknown,
) {
  return request(
    base + path,
    signal,
    body === undefined ? "GET" : "POST",
    body,
  );
}
export function changeKey(c: Change) {
  return [
    c.kind,
    ...[
      "subject_id",
      "module",
      "action",
      "provider",
      "model",
      "scope",
      "key",
      "period",
    ].map((k) => c[k] ?? ""),
  ].join("|");
}
export function validChange(c: unknown): c is Change {
  if (!object(c)) return false;
  const fields: Record<string, string[]> = {
    entitlement: [
      "kind",
      "reason",
      "subject_id",
      "module",
      "action",
      "effect",
      "expires_at",
    ],
    ai_grant: [
      "kind",
      "reason",
      "subject_id",
      "module",
      "provider",
      "model",
      "effect",
      "expires_at",
    ],
    catalog_visibility: ["kind", "reason", "module", "visibility"],
    module: ["kind", "reason", "module", "enabled"],
    account: ["kind", "subject_id", "blocked"],
    revoke_sessions: ["kind", "subject_id"],
    registration: ["kind", "mode"],
    limit: [
      "kind",
      "scope",
      "key",
      "period",
      "usd_micro",
      "requests",
      "tokens",
    ],
    timezone: ["kind", "name"],
    dispatcher: ["kind", "timeout_seconds"],
  };
  if (
    typeof c.kind !== "string" ||
    !Object.hasOwn(fields, c.kind) ||
    Object.keys(c).some((k) => !fields[c.kind as string].includes(k))
  )
    return false;
  return Object.values(c).every(
    (v) =>
      v === null ||
      typeof v === "boolean" ||
      (typeof v === "number" && integer(v) && v <= 1e12) ||
      (typeof v === "string" && v.length <= 160),
  );
}
export const usd = (v: number | null) =>
  v === null
    ? "Не задан"
    : new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 6,
      }).format(v / 1e6);
export const capText = (v: number | null, money = false) =>
  v === null ? "" : money ? String(v / 1e6) : String(v);
export function amount(s: string, money = false): number | null {
  if (s.trim() === "") return null;
  const v = s.replace(",", ".");
  if (!(money ? /^\d{1,7}(?:\.\d{0,6})?$/ : /^\d{1,13}$/).test(v))
    throw new Error(
      "Проверь лимиты: деньги — до шести знаков после запятой, запросы и токены — целые числа.",
    );
  const n = money
    ? Number(v.split(".")[0]) * 1e6 +
      Number((v.split(".")[1] || "").padEnd(6, "0"))
    : Number(v);
  if (!Number.isSafeInteger(n) || n > 1e12)
    throw new Error("Лимит слишком большой.");
  return n;
}
