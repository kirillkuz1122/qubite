import { useEffect, useState } from "react";
import { App } from "./App";
import { FluxStudio } from "./flux/FluxStudio";
import { MiloLab } from "./milo/MiloLab";
export function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return !hash || hash === "#" || hash.startsWith("#/flux/") ? (
    <FluxStudio />
  ) : hash.startsWith("#/milo/v2/") ? (
    <MiloLab />
  ) : (
    <App />
  );
}
