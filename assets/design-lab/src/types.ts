export type Direction = "nacre" | "ferro" | "folio" | "prism" | "milo";
export type View = "landing" | "workspace" | "auth" | "material";
export type Mood =
  | "idle"
  | "focus"
  | "private"
  | "success"
  | "error"
  | "search"
  | "connect"
  | "capture";
export type Section =
  | "today"
  | "docs"
  | "search"
  | "writing"
  | "vpn"
  | "modules"
  | "settings"
  | "console";
export interface Concept {
  id: Direction;
  number: string;
  name: string;
  russian: string;
  material: string;
  title: string[];
  description: string;
  detail: string;
  font: string;
  palette: string[];
  motion: string;
  tagline: string;
}
export interface PageProps {
  concept: Concept;
  open: (view: View) => void;
  mood: Mood;
  event: number;
  react: (mood: Mood) => void;
}
