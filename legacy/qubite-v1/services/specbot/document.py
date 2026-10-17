"""Cyrillic PDF, Markdown and source JSON; all model text is escaped."""
from datetime import datetime, timezone
from html import escape
import json
import os
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer


def exports(directory,sid,title,data,version):
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    stem=directory/(sid+'-v'+str(version))
    fonts=[('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),('/usr/share/fonts/TTF/DejaVuSans.ttf','/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'),('/usr/share/fonts/noto/NotoSans-Regular.ttf','/usr/share/fonts/noto/NotoSans-Bold.ttf')]
    regular,bold=next(((a,b) for a,b in fonts if Path(a).is_file() and Path(b).is_file()),(None,None))
    if not regular:raise ValueError('Нужен шрифт с кириллицей: DejaVu Sans или Noto Sans.')
    pdfmetrics.registerFont(TTFont('Qubite',regular))
    pdfmetrics.registerFont(TTFont('QubiteBold',bold))
    base=ParagraphStyle('body',fontName='Qubite',fontSize=10,leading=16,spaceAfter=7,textColor=colors.HexColor('#182132'),splitLongWords=True)
    h=ParagraphStyle('heading',parent=base,fontName='QubiteBold',fontSize=14,leading=20,spaceBefore=15,spaceAfter=10,keepWithNext=True)
    cover=ParagraphStyle('title',parent=h,fontSize=23,leading=30)
    para=lambda t,style=base:Paragraph(escape(str(t)).replace('\n','<br/>'),style)
    date=datetime.now(timezone.utc).strftime('%d.%m.%Y')
    story=[para('QUBITE · ТЕХНИЧЕСКОЕ ЗАДАНИЕ',h),para(data['title'],cover),
           para('Черновик для согласования · версия '+str(version)+' · '+date),para(data['summary']),Spacer(1,10)]
    md=['# '+data['title'],'','Черновик для согласования · версия '+str(version)+' · '+date,'',data['summary']]
    for section in data['sections']:
        story.append(para(section['title'],h));md.extend(['','## '+section['title'],''])
        for item in section['items']:story.append(para('• '+item));md.append('- '+item)
    story.append(para('Декомпозиция и предварительная сложность',h));md.extend(['','## Декомпозиция и предварительная сложность',''])
    for module in data['modules']:
        t=module['name']+' — '+module['complexity']+' сложность. '+module['scope']+' Обоснование: '+module['reason']
        story.append(para(t));md.append('- '+t)
    for key,label in [('acceptance','Критерии приёмки'),('assumptions','Предположения: требуют подтверждения'),('open_questions','Открытые вопросы')]:
        story.append(para(label,h));md.extend(['','## '+label,''])
        for t in data[key] or ['Не указано в интервью.']:
            story.append(para('• '+t));md.append('- '+t)
    footer='Документ собран по интервью. Цена, сроки и сложность не являются обязательством исполнителя до согласования.'
    story.append(Spacer(1,15));story.append(para(footer));md.extend(['',footer])
    def page(canvas,doc):
        canvas.setStrokeColor(colors.HexColor('#f43f5e'));canvas.line(40,806,555,806)
        canvas.setFont('Qubite',8);canvas.setFillColor(colors.HexColor('#666666'))
        canvas.drawString(40,28,'Qubite · '+sid+' · v'+str(version));canvas.drawRightString(555,28,str(doc.page))
    doc=SimpleDocTemplate(str(stem)+'.pdf',pagesize=A4,rightMargin=40,leftMargin=40,topMargin=50,bottomMargin=50,title=data['title'],author='Qubite')
    doc.build(story,onFirstPage=page,onLaterPages=page)
    Path(str(stem)+'.md').write_text('\n'.join(md),encoding='utf8')
    Path(str(stem)+'.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    for suffix in ('.pdf','.md','.json'):os.chmod(str(stem)+suffix,0o600)
    return str(stem)
