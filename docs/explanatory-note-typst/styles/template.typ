#import "../config/metadata.typ": *

#set text(lang: "ru", font: "Liberation Serif", size: 14pt)
#set page(
  paper: "a4",
  margin: (top: 2cm, bottom: 2cm, left: 3cm, right: 1.5cm),
  numbering: "1",
  number-align: top + right,
)
#set par(justify: true, first-line-indent: 1.25cm, leading: 7pt)
#set heading(numbering: none)

#show heading.where(level: 1): it => block(above: 1.25em, below: 0.65em)[
  #set text(weight: "bold", size: 14pt)
  #align(center)[#it]
]

#show heading.where(level: 2): it => block(above: 1em, below: 0.45em)[
  #set text(weight: "bold", size: 14pt)
  #it
]

#let simple_table(rows, columns: (35%, 65%)) = table(
  columns: columns,
  inset: 8pt,
  stroke: 0.4pt + luma(180),
  ..rows,
)

#let label_value_table(rows) = table(
  columns: (32%, 68%),
  inset: 6pt,
  stroke: none,
  ..rows,
)

#let running_header() = context {
  let current_page = counter(page).get().first()
  let upcoming = query(selector(heading.where(level: 1)).after(here()))
  let next_same_page = upcoming.filter(it => counter(page).at(it.location()).first() == current_page)
  let previous = query(selector(heading.where(level: 1)).before(here()))
  let header_body = if next_same_page.len() > 0 {
    next_same_page.first().body
  } else if previous.len() > 0 {
    previous.last().body
  } else {
    []
  }

  if header_body == [] {
    []
  } else [
    #set text(size: 10pt, fill: luma(70))
    #set par(first-line-indent: 0pt)
    #align(right)[#header_body]
    #v(2pt)
    #line(length: 100%, stroke: 0.4pt + luma(180))
  ]
}

#let title_page() = align(center + horizon)[
  #set par(first-line-indent: 0pt, leading: 4pt)
  #v(1.4cm)
  #text(size: 14pt)[#school_name]
  #v(5.2cm)
  #text(weight: "bold")[#document_title]
  #v(0.6cm)
  #text(weight: "bold")[«#topic»]
  #v(0.5cm)
  #text()[#subject_name]
  #v(4.2cm)
  #align(right)[
    #table(
      columns: (auto, 6.2cm),
      stroke: none,
      inset: 2pt,
      [Выполнил:], [ученик #student_class #student_name],
      [Руководитель:], [#supervisor_name],
    )
  ]
  #v(6.2cm)
  #text()[#city, #year]
]
