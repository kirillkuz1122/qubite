import { hasGrant, type Session } from "./identity";
export type Visibility = "hidden" | "locked";
export type Module = {
  id: string;
  name: string;
  summary: string;
  tone: string;
  icon: string;
  label: string;
};
export const modules: Module[] = [
  {
    id: "docs",
    name: "Документы",
    summary: "Место для мыслей, заметок и знаний.",
    tone: "yellow",
    icon: "document",
    label: "Qubite Docs",
  },
  {
    id: "projects",
    name: "Проекты",
    summary: "От первой идеи до последнего шага.",
    tone: "blue",
    icon: "layers",
    label: "Qubite Projects",
  },
  {
    id: "planner",
    name: "Планировщик",
    summary: "Дела, которые обретают свой ритм.",
    tone: "green",
    icon: "calendar",
    label: "Qubite Planner",
  },
  {
    id: "search",
    name: "Поиск",
    summary: "Найти ответ и вернуться к источнику.",
    tone: "orange",
    icon: "search",
    label: "Qubite Search",
  },
  {
    id: "writing",
    name: "Редактор",
    summary: "Текст, в котором слышно тебя.",
    tone: "yellow",
    icon: "pen",
    label: "Qubite Writing",
  },
  {
    id: "vpn",
    name: "Соединение",
    summary: "Твоё личное защищённое соединение.",
    tone: "blue",
    icon: "shield",
    label: "Qubite VPN",
  },
  {
    id: "vault",
    name: "Хранилище",
    summary: "Отдельное место для секретов.",
    tone: "green",
    icon: "lock",
    label: "Qubite Vault",
  },
  {
    id: "atlas",
    name: "Атлас",
    summary: "Увидеть связи между своими идеями.",
    tone: "orange",
    icon: "orbit",
    label: "Qubite Atlas",
  },
];
export type VisibilityMap = Record<string, Visibility>;
export const demoVisibility = (): VisibilityMap =>
  Object.fromEntries(
    modules.map((m) => [
      m.id,
      ["vpn", "vault", "atlas"].includes(m.id) ? "hidden" : "locked",
    ]),
  );
// The server catalog protocol is a separate task. Live mode exposes no denied catalog.
export const liveVisibility = (): VisibilityMap =>
  Object.fromEntries(modules.map((m) => [m.id, "hidden"]));
export function moduleState(
  session: Session,
  id: string,
  visibility: VisibilityMap,
): "missing" | "denied" | "unavailable" {
  if (!modules.some((m) => m.id === id)) return "missing";
  if (hasGrant(session, id, "read")) return "unavailable";
  return visibility[id] === "locked" ? "denied" : "missing";
}
