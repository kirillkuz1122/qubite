# Журнал завершения задач Qubite

Актуальные статусы и evidence — в [tasks.json](../plan/tasks.json), [handoff](LAST_HANDOFF.md) и датированных отчётах. Этот журнал фиксирует результат bounded cycle; source tests не означают приёмку устройства или рабочий deployment.

## 13.10.2026 — QUB-REPO-001

Перенос старого сайта/deploy/HTML/учебных материалов и Flutter VPN в legacy; standalone optional Tournaments без нового SSO; оставшиеся сервисы маркированы reference. Корневые инструкции описывают универсальную платформу. Filled deploy env сохранён, root env новый пустой, предыдущий root env сохранён приватно. Добавлены discovery задач сервисов и будущие installer/operator требования. Проверки и Git/CI evidence — [полный отчёт](../reports/QUB-REPO-001.md). Реальный installer/deploy и новый UI не исполнялись.

## Предыдущие задачи

AUTH-006: owner-controlled registration API, core0.6.0/0007, [отчёт](../reports/QUB-AUTH-006.md). AUTH-005: email/password boundary, [отчёт](../reports/QUB-AUTH-005.md). Другие завершённые implementation slices и их exact-SHA CI сохранены в registry и [каталоге отчётов](../reports/); не заменять их evidence результатами текущего переноса.
