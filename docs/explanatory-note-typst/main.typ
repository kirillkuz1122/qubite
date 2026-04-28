#import "styles/template.typ": *

#show: doc => {
  set document(title: document_title, author: "Codex")
  doc
}

#set page(numbering: none)
#title_page()

#pagebreak()

#align(center)[#text(weight: "bold")[ОГЛАВЛЕНИЕ]]
#set par(first-line-indent: 0pt)
#outline(title: none, indent: 1.2em)

#pagebreak()
#set page(numbering: "1", number-align: top + right)
#set par(first-line-indent: 1.25cm, leading: 0.75em)

#include "sections/01-introduction.typ"

#pagebreak()
#include "sections/02-purpose-and-domain.typ"

#pagebreak()
#include "sections/03-project-structure.typ"
#include "sections/04-architecture.typ"

#pagebreak()
#include "sections/05-technologies.typ"

#pagebreak()
#include "sections/06-functionality.typ"

#pagebreak()
#include "sections/07-appendix.typ"
