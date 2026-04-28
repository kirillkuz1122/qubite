#import "../config/metadata.typ": *

#set text(lang: "ru", font: ("Times New Roman", "Liberation Serif"), size: 14pt)
#set page(
  paper: "a4",
  margin: (top: 2cm, bottom: 2cm, left: 3cm, right: 1.5cm),
  numbering: "1",
  number-align: top + right,
)
#set par(justify: true, first-line-indent: (amount: 1.25cm, all: true), leading: 0.75em)
#set heading(numbering: none)

#show heading.where(level: 1): it => {
  block(above: 1.25em, below: 0.65em)[
    #set text(weight: "bold", size: 14pt)
    #set par(first-line-indent: 0pt)
    #align(center)[#it]
  ]
}

#show heading.where(level: 2): it => {
  block(above: 1em, below: 0.45em)[
    #set text(weight: "bold", size: 14pt)
    #set par(first-line-indent: 0pt)
    #it
  ]
}

#let simple_table(rows, columns: (35%, 65%)) = block(
  breakable: false,
  above: 0.45em,
  below: 0.45em,
)[
  #set par(first-line-indent: 0pt)
  #table(
    columns: columns,
    inset: 8pt,
    stroke: 0.4pt + luma(180),
    ..rows,
  )
]

#let label_value_table(rows) = block(
  breakable: false,
)[
  #set par(first-line-indent: 0pt)
  #table(
    columns: (32%, 68%),
    inset: 6pt,
    stroke: none,
    ..rows,
  )
]

#let figure_image(path, caption_text, width: 92%) = {
  counter("figure").step()
  context {
    let number = counter("figure").get().first()
    block(breakable: false)[
      #align(center)[#image(path, width: width)]
      #v(4pt)
      #set par(first-line-indent: 0pt)
      #align(center)[#text(size: 12pt)[Рисунок #number — #caption_text]]
    ]
  }
}

#let callout(title, body) = block(
  inset: 10pt,
  radius: 0pt,
  stroke: (left: 2pt + rgb("#f43f5e"), rest: 0.4pt + luma(190)),
  fill: luma(248),
)[
  #set par(first-line-indent: 0pt)
  #text(weight: "bold")[#title]
  #v(4pt)
  #body
]

#let title_page() = {
  set par(first-line-indent: 0pt, leading: 0.65em)
  set align(center)

  v(1cm)
  text(size: 14pt)[#school_name]
  v(1fr)
  text(weight: "bold", size: 14pt)[#document_title]
  v(0.6cm)
  text(weight: "bold", size: 14pt)[«#topic»]
  v(0.5cm)
  text(size: 14pt)[#subject_name]
  v(1fr)
  align(right)[
    #set par(first-line-indent: 0pt)
    #table(
      columns: (auto, auto),
      stroke: none,
      inset: 2pt,
      align: left,
      [Выполнил:], [ученик #student_class #student_name],
      [Руководитель:], [#supervisor_name],
    )
  ]
  v(1fr)
  text(size: 14pt)[#city, #year год]
}
