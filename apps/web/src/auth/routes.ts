import { useEffect, useState } from "react";
import { token, uuid } from "./api";
let entrySequence = 0;
export type AuthEntry = {
  sequence?: number;
  route: string;
  invite?: string;
  proof?: { challenge_id: string; token: string };
  error?: string;
};
export function consumeAuthLink(): AuthEntry {
  const [route, query] = location.hash.slice(1).split("?", 2);
  const entry: AuthEntry = { route: route || "/", sequence: ++entrySequence };
  if (!query) return entry;
  // Purge possession proofs before React, identity requests, or user interaction.
  history.replaceState(
    null,
    "",
    location.pathname + (route?.startsWith("/auth/") ? "#" + route : "#/"),
  );
  const invalid = (): AuthEntry => {
    history.replaceState(null, "", location.pathname + "#/auth/login");
    return {
      route: "/auth/login",
      sequence: entry.sequence,
      error: "invalid_challenge",
    };
  };
  const params = new URLSearchParams(query);
  const unique = new Set(params.keys()).size === Array.from(params).length;
  if (!unique || query.length > 1024) return invalid();
  if (
    route === "/auth/register" &&
    Array.from(params.keys()).join() === "invite" &&
    token(params.get("invite") || "", "qbt_ri_")
  )
    entry.invite = params.get("invite")!;
  else if (
    ["/auth/verify", "/auth/reset-confirm"].includes(route) &&
    Array.from(params.keys()).sort().join() === "challenge_id,token" &&
    uuid.test(params.get("challenge_id") || "") &&
    token(
      params.get("token") || "",
      route === "/auth/verify" ? "qbt_ev_" : "qbt_er_",
    )
  )
    entry.proof = {
      challenge_id: params.get("challenge_id")!,
      token: params.get("token")!,
    };
  else if (
    route === "/auth/login" &&
    Array.from(params.keys()).join() === "error" &&
    /^[a-z_]{1,50}$/.test(params.get("error") || "")
  )
    entry.error = params.get("error")!;
  else return invalid();
  return entry;
}
export function parseInvite(value: string): string | null {
  const raw = value.trim();
  if (token(raw, "qbt_ri_")) return raw;
  try {
    const url = new URL(raw);
    const [route, query] = url.hash.slice(1).split("?");
    const params = new URLSearchParams(query);
    const invite = params.get("invite") || "";
    if (
      url.origin === location.origin &&
      !url.search &&
      !url.username &&
      !url.password &&
      route === "/auth/register" &&
      Array.from(params).length === 1 &&
      token(invite, "qbt_ri_")
    )
      return invite;
  } catch {
    /* Raw input is never copied to an error or log. */
  }
  return null;
}
export function useRoute() {
  const [route, setRoute] = useState(
    () => location.hash.slice(1).split("?")[0] || "/",
  );
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1).split("?")[0] || "/");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}
