import { useCallback, useEffect, useRef, useState } from "react";

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  platform_owner: boolean;
};
export type Grant = {
  module: string;
  action: "read" | "write" | "manage" | "ai";
  expires_at: string | null;
};
export type Session = { profile: Profile; grants: Grant[] };
export type Identity =
  | { status: "loading" | "anonymous" | "unavailable"; session?: never }
  | { status: "authenticated"; session: Session };
export type Persona = "owner" | "member" | "new";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join() === expected.sort().join();

export function parseProfile(v: unknown): Profile {
  if (
    !object(v) ||
    !keys(v, ["id", "email", "display_name", "platform_owner"]) ||
    typeof v.id !== "string" ||
    !uuid.test(v.id) ||
    typeof v.email !== "string" ||
    v.email.length > 320 ||
    !v.email.includes("@") ||
    !(
      v.display_name === null ||
      (typeof v.display_name === "string" && v.display_name.length <= 200)
    ) ||
    typeof v.platform_owner !== "boolean"
  )
    throw Error("invalid_identity");
  return v as Profile;
}
export function parseAccess(v: unknown): Grant[] {
  if (
    !object(v) ||
    !keys(v, ["revision", "items"]) ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 1 ||
    !Array.isArray(v.items) ||
    v.items.length > 4096
  )
    throw Error("invalid_access");
  return v.items.map((item: unknown) => {
    if (
      !object(item) ||
      !keys(item, ["module", "action", "expires_at"]) ||
      typeof item.module !== "string" ||
      !/^[a-z][a-z0-9_]{0,31}$/.test(item.module) ||
      typeof item.action !== "string" ||
      !["read", "write", "manage", "ai"].includes(item.action) ||
      !(
        item.expires_at === null ||
        (typeof item.expires_at === "string" &&
          /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item.expires_at) &&
          Number.isFinite(Date.parse(item.expires_at)))
      )
    )
      throw Error("invalid_access");
    return item as Grant;
  });
}
export function hasGrant(
  session: Session,
  module: string,
  action: Grant["action"],
): boolean {
  return session.grants.some(
    (g) =>
      g.module === module &&
      g.action === action &&
      (g.expires_at === null || Date.parse(g.expires_at) > Date.now()),
  );
}
class SessionFault extends Error {
  constructor(public status: number) {
    super("session_unavailable");
  }
}
async function readJSON(path: string, signal: AbortSignal): Promise<unknown> {
  const r = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new SessionFault(r.status);
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw Error("invalid_response");
  const text = await r.text();
  if (text.length > 524288) throw Error("invalid_response");
  return JSON.parse(text);
}
export function useIdentity(): { identity: Identity; refresh: () => void } {
  const [identity, setIdentity] = useState<Identity>({ status: "loading" });
  const latest = useRef(0),
    controller = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    const generation = ++latest.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    // Drop private data while rechecking, rather than keeping a stale owner.
    setIdentity((previous) =>
      previous.status === "authenticated" ? { status: "loading" } : previous,
    );
    const timeout = setTimeout(() => current.abort(), 8000);
    (async () => {
      try {
        const profile = parseProfile(
          await readJSON("/api/v1/me", current.signal),
        );
        const grants = parseAccess(
          await readJSON("/api/v1/me/access", current.signal),
        );
        if (generation === latest.current)
          setIdentity({
            status: "authenticated",
            session: { profile, grants },
          });
      } catch (error) {
        if (generation === latest.current)
          setIdentity({
            status:
              error instanceof SessionFault && [401, 403].includes(error.status)
                ? "anonymous"
                : "unavailable",
          });
      } finally {
        clearTimeout(timeout);
      }
    })();
  }, []);
  useEffect(() => {
    refresh();
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(visible, 60000);
    return () => {
      ++latest.current;
      controller.current?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  return { identity, refresh };
}
export function demoSession(persona: Persona): Session {
  const grants: Grant[] =
    persona === "new"
      ? []
      : [
          "docs",
          "inbox",
          ...(persona === "owner" ? ["projects", "planner"] : []),
        ].map((module) => ({ module, action: "read", expires_at: null }));
  if (persona !== "new")
    grants.push({ module: "inbox", action: "write", expires_at: null });
  return {
    profile: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "example@example.test",
      display_name:
        persona === "owner"
          ? "Кирилл"
          : persona === "member"
            ? "Алекс"
            : "Новый пользователь",
      platform_owner: persona === "owner",
    },
    grants,
  };
}
