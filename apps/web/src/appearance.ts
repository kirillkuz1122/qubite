import { useEffect, useMemo, useState } from "react";
import { profiles } from "./material/profiles";

export type Preferences = {
  quiet: boolean;
  dark: boolean;
  strength: number;
  duration: number;
  lite: boolean;
};
function readPreferences(): Preferences {
  const defaults = {
    quiet: false,
    dark: false,
    strength: 100,
    duration: 503,
    lite: matchMedia("(pointer: coarse)").matches,
  };
  try {
    const value = JSON.parse(localStorage.getItem("qubite.ui.v1") || "null");
    return {
      quiet: value?.quiet === true,
      dark: value?.dark === true,
      strength: Number.isFinite(value?.strength)
        ? Math.max(0, Math.min(100, value.strength))
        : 100,
      duration: Number.isFinite(value?.duration)
        ? Math.max(250, Math.min(900, value.duration))
        : 503,
      lite: typeof value?.lite === "boolean" ? value.lite : defaults.lite,
    };
  } catch {
    return defaults;
  }
}
export function useAppearance() {
  const [prefs, setPrefs] = useState(readPreferences);
  const [systemQuiet, setSystemQuiet] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemQuiet(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("qubite.ui.v1", JSON.stringify(prefs));
    } catch {
      /* Cosmetic only. */
    }
  }, [prefs]);
  const stopped = prefs.quiet || systemQuiet || prefs.strength === 0;
  const motion = useMemo(
    () => ({
      profile: profiles[1],
      strength: prefs.strength / 100,
      quiet: stopped,
      selectionMs: prefs.duration,
      lite: prefs.lite,
    }),
    [prefs, stopped],
  );
  return { prefs, setPrefs, stopped, motion };
}
