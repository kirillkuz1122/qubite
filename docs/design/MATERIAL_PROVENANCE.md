# Происхождение живого материала

UI-002, 13.10.2026. Дизайн уже выбран владельцем: Поток, Игрушечная, Лента, Unbounded/Manrope,100%/503мс. Рабочий клиент использует компоненты из своей `src/material/`; ниже указано, какие готовые assets перенесены. Прототип не служит API/авторизацией.

| Утверждённый источник | Компонент приложения | Адаптация для приложения |
|---|---|---|
| assets/design-lab/src/milo/motion.tsx | apps/web/src/material/motion.tsx | Сохранены scheduler, пружина130/21, bounded travel28, squash.18, twist3, smoothstep и retarget из текущих координат |
| assets/design-lab/src/milo/profiles.ts | apps/web/src/material/profiles.ts | Рабочий provider выбирает только profiles[1], остальные — сохранённое описание источника |
| assets/design-lab/src/milo/Controls.tsx | apps/web/src/material/Controls.tsx | LivingButton/Slider/Switch/Tabs/Navigation; добавлен LivingLink, composition внешних handlers, default button type, pointer ownership/cancel и settle при drag в тот же пункт; ссылки участвуют в geometry navigation |
| assets/design-lab/src/milo/Transition.tsx | apps/web/src/material/Transition.tsx | MorphContent,503мс из preference; уходящий inert слой и очистка значений inputs до сохранения снимка |
| assets/design-lab/src/milo/milo.css и flux/flux.css | apps/web/src/material/material.css и styles.css | Базовая geometry + только профиль Потока, 2D pill/lightweight/touch, will-change только на движущихся элементах |
| assets/design-lab/src/flux/Marks.tsx | apps/web/src/material/Marks.tsx | Точные Ribbon Q/service SVG strokes; явные semantic aliases docs→notes/projects→brief/planner→tasks/atlas→notebook не подключают старые сервисы |
| assets/design-lab/src/flux/preferences.ts и plastic.css | apps/web/src/styles.css | Утверждённые Toy цвета и их роли, обе темы, читаемый foreground отдельно от пигмента |
| assets/design-lab/public/licenses | apps/web/public/licenses | Неизменённые OFL Manrope/Unbounded; шрифты self-hosted через зафиксированный Fontsource |

Это осознанное выделение утверждённых assets в production-слой. Не импортировать FluxStudio/Workspace/Auth/демо-аккаунты из витрины и не копировать новый UI заново для каждого модуля. Новые screens используют эту же библиотеку. Изменения витрины не должны автоматически попадать в рабочий клиент без review/проверки выбранного поведения.

[Контракт дизайна](FLUX_DESIGN_SYSTEM.md), [решение](../architecture/decisions/0023-approved-flux-material-in-web.md), [отчёт](../reports/QUB-UI-002.md). Питомцы и их event/AI dispatcher отдельно; живость материала не заменяется декоративным помощником.

AUTH-007: тот же src/material обслуживает Public landing/Auth, tabs/submit/password toggle/legal switches/profile sessions, shared useAppearance. Sensitive forms privateContent не создают departing DOM snapshots; layout fields стабильны. Quiet LivingButton сохраняет type=button (submit только явно), disabled switches не меняют consent во время отправки.

UI-003: OwnerCatalog общий live/demo компонент, existing LivingTabs/LivingButton, explicit per-row save/unsaved label, password только live. Existing Flux500ms profile/503 selection setting, no new physics/controls. Native resize/touch/quiet/lite unchanged. Live catalog scenes use incoming MorphContent, без private outgoing snapshots. Metadata/status не заменяют grants.
