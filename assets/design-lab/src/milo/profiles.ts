export type MaterialKind = "souffle" | "flux" | "halo" | "orbit" | "bloom";
export const profiles = [
  {
    id: "souffle",
    name: "Суфле",
    caption: "Мягкость с характером",
    detail:
      "Объёмная мягкая поверхность. Сжимается под пальцем, вытягивается при движении и упруго собирается обратно.",
    stiffness: 280,
    damping: 16,
    travel: 22,
    squash: 0.13,
    twist: 4,
    release: "пружина",
    color: "#ff7845",
  },
  {
    id: "flux",
    name: "Поток",
    caption: "Форма следует за тобой",
    detail:
      "Вязкий пигмент. Течёт с небольшой задержкой, меняет края по направлению движения. Выбор растягивается между пунктами.",
    stiffness: 130,
    damping: 21,
    travel: 28,
    squash: 0.18,
    twist: 3,
    release: "вязкость",
    color: "#7e5abe",
  },
  {
    id: "halo",
    name: "Ореол",
    caption: "Свет внутри цвета",
    detail:
      "Плотная непрозрачная поверхность. Касание зажигает цвет внутри, свет проходит по краю и отзывается в соседних элементах.",
    stiffness: 360,
    damping: 30,
    travel: 10,
    squash: 0.045,
    twist: 1,
    release: "затухание",
    color: "#b65023",
  },
  {
    id: "orbit",
    name: "Магнит",
    caption: "Ты — центр притяжения",
    detail:
      "Пигмент с ощущением веса. Тянется к пальцу в заданных пределах, набирает инерцию и точно садится в выбранное место.",
    stiffness: 230,
    damping: 19,
    travel: 19,
    squash: 0.08,
    twist: 6,
    release: "инерция",
    color: "#405d8e",
  },
  {
    id: "bloom",
    name: "Лепестки",
    caption: "Каждое действие раскрывается",
    detail:
      "Податливые края и складки. Кнопка раскрывается в меню, состояния перетекают слоями, нажатие собирает форму вокруг касания.",
    stiffness: 210,
    damping: 24,
    travel: 18,
    squash: 0.11,
    twist: 2,
    release: "раскрытие",
    color: "#45633c",
  },
] as const;
export type Profile = (typeof profiles)[number];
