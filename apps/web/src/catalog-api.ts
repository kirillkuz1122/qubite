import { useCallback, useEffect, useRef, useState } from "react";
import { request, AuthFault } from "./auth/api";
import type { Module, Visibility } from "./catalog";
export type State = "locked" | "preparing" | "unavailable" | "ready";
export type Card = Module & {
  status: State;
  visibility: Visibility;
  access_expires_at: string | null;
};
export type OwnerCard = Card & {
  installed: boolean;
  enabled: boolean;
  released: boolean;
};
export type Catalog<T = Card> = { revision: number; items: T[] };
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join() === expected.sort().join();
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseCatalog(
  value: unknown,
  owner = false,
): Catalog<Card | OwnerCard> {
  if (
    !record(value) ||
    !keys(value, ["revision", "items"]) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !Array.isArray(value.items) ||
    value.items.length > 128
  )
    throw new AuthFault("invalid_response");
  const seen = new Set<string>();
  const items = value.items.map((v: unknown) => {
    const fields = [
      "module",
      "name",
      "summary",
      "label",
      "tone",
      "icon",
      "visibility",
      "status",
      "access_expires_at",
    ];
    if (owner) fields.push("installed", "enabled", "released");
    if (
      !record(v) ||
      !keys(v, fields) ||
      typeof v.module !== "string" ||
      !/^[a-z][a-z0-9_]{0,31}$/.test(v.module) ||
      seen.has(v.module) ||
      ["name", "summary", "label"].some(
        (k) =>
          typeof v[k] !== "string" ||
          !(v[k] as string).length ||
          (v[k] as string).length > (k === "summary" ? 400 : 100),
      ) ||
      !["orange", "blue", "yellow", "green"].includes(v.tone as string) ||
      ![
        "document",
        "layers",
        "calendar",
        "search",
        "pen",
        "shield",
        "lock",
        "orbit",
      ].includes(v.icon as string) ||
      !["hidden", "locked"].includes(v.visibility as string) ||
      !["locked", "preparing", "unavailable", "ready"].includes(
        v.status as string,
      ) ||
      !(
        v.access_expires_at === null ||
        (typeof v.access_expires_at === "string" &&
          /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.access_expires_at) &&
          Number.isFinite(Date.parse(v.access_expires_at)))
      ) ||
      (v.status === "locked" &&
        (v.visibility !== "locked" || v.access_expires_at !== null)) ||
      (owner &&
        ["installed", "enabled", "released"].some(
          (k) => typeof v[k] !== "boolean",
        ))
    )
      throw new AuthFault("invalid_response");
    seen.add(v.module);
    return {
      id: v.module,
      name: v.name,
      summary: v.summary,
      label: v.label,
      tone: v.tone,
      icon: v.icon,
      status: v.status,
      visibility: v.visibility,
      access_expires_at: v.access_expires_at,
      ...(owner
        ? { installed: v.installed, enabled: v.enabled, released: v.released }
        : {}),
    } as Card | OwnerCard;
  });
  return { revision: value.revision as number, items };
}
export const statusText = (s: State) =>
  ({
    locked: "Нет доступа",
    preparing: "Готовится",
    unavailable: "Временно недоступен",
    ready: "Доступен",
  })[s];
type Snapshot = {
  state: "loading" | "ready" | "unavailable";
  catalog: Catalog<Card>;
  missing: boolean;
};
const empty = (): Snapshot => ({
  state: "loading",
  catalog: { revision: 1, items: [] },
  missing: false,
});
export function useCatalog(
  demo: boolean,
  route: string,
  onSessionFault?: () => void,
) {
  const [snapshot, setSnapshot] = useState(empty);
  const generation = useRef(0),
    current = useRef<AbortController | null>(null),
    fault = useRef(onSessionFault);
  fault.current = onSessionFault;
  const reload = useCallback(() => {
    if (demo) return;
    const n = ++generation.current;
    current.current?.abort();
    const c = new AbortController();
    current.current = c;
    setSnapshot(empty());
    const timeout = setTimeout(() => c.abort(), 8000);
    void (async () => {
      try {
        const catalog = parseCatalog(
          await request("/api/v1/me/modules", c.signal),
        ) as Catalog<Card>;
        let missing = false;
        if (route.startsWith("/modules/")) {
          const id = route.slice("/modules/".length);
          if (!/^[a-z][a-z0-9_]{0,31}$/.test(id)) missing = true;
          else
            try {
              const detail = parseCatalog(
                await request("/api/v1/me/modules/" + id, c.signal),
              );
              if (
                detail.items.length !== 1 ||
                detail.items[0].id !== id ||
                detail.revision !== catalog.revision ||
                JSON.stringify(detail.items[0]) !==
                  JSON.stringify(catalog.items.find((m) => m.id === id))
              )
                throw new AuthFault("policy_conflict");
            } catch (e) {
              if (e instanceof AuthFault && e.status === 404) missing = true;
              else throw e;
            }
        }
        if (n === generation.current && !c.signal.aborted)
          setSnapshot({ state: "ready", catalog, missing });
      } catch (e) {
        if (n === generation.current) {
          setSnapshot({
            state: "unavailable",
            catalog: { revision: 1, items: [] },
            missing: false,
          });
          if (e instanceof AuthFault && [401, 403].includes(e.status))
            fault.current?.();
        }
      } finally {
        clearTimeout(timeout);
      }
    })();
  }, [demo, route]);
  useEffect(() => {
    reload();
    if (demo) return;
    const visible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    const interval = setInterval(visible, 60000);
    return () => {
      ++generation.current;
      current.current?.abort();
      clearInterval(interval);
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [reload, demo]);
  useEffect(() => {
    if (demo || snapshot.state !== "ready") return;
    const expiries = snapshot.catalog.items.flatMap((m) =>
      m.access_expires_at ? [Date.parse(m.access_expires_at)] : [],
    );
    const future = expiries.filter((t) => t > Date.now());
    if (!future.length) return;
    const delay = Math.max(0, Math.min(...future) - Date.now());
    const timer = setTimeout(reload, Math.min(delay + 1, 2147483647));
    return () => clearTimeout(timer);
  }, [demo, snapshot, reload]);
  // Never render a grant that expires between the server snapshot and this render.
  const items = snapshot.catalog.items.flatMap((m) => {
    if (
      m.status !== "locked" &&
      m.access_expires_at &&
      Date.parse(m.access_expires_at) <= Date.now()
    )
      return m.visibility === "hidden"
        ? []
        : [{ ...m, status: "locked" as State, access_expires_at: null }];
    return [m];
  });
  return { ...snapshot, catalog: { ...snapshot.catalog, items }, reload };
}
