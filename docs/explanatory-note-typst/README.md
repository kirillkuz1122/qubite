# Пояснительная записка в Typst

Структура каталога:

- `main.typ` — главный файл сборки итогового документа.
- `config/metadata.typ` — метаданные и параметры титульной части.
- `styles/template.typ` — общие стили, макросы и оформление документа.
- `sections/*.typ` — разделы пояснительной записки.
- `output/` — каталог для собранного PDF.

Пример сборки:

```bash
mkdir -p output
typst compile main.typ output/individual-project-note.pdf
```
