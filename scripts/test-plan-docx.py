"""Turns docs/MANUAL_TEST_PLAN.md into a styled Word test plan (A4).

    python3 scripts/test-plan-docx.py docs/MANUAL_TEST_PLAN.md docs/Pakka-manual-test-plan.docx
"""
import re
import sys
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

SRC, OUT = sys.argv[1], sys.argv[2]
SUBTITLE = sys.argv[3] if len(sys.argv) > 3 else "Consumer app, money rules, demo world, merchant and ops consoles, Pakka for Business, agent API and Python SDK, security and AI safety."
BRANCH = sys.argv[4] if len(sys.argv) > 4 else "sarvam-voice"
NAVY = RGBColor(0x00, 0x2E, 0x6E)
INK = RGBColor(0x12, 0x22, 0x3F)
SLATE = RGBColor(0x56, 0x65, 0x7F)
FONT, MONO = "Arial", "Consolas"


def shade(cell, hex_fill):
    tc = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc.append(shd)


def borders(table, color="CBD5E3"):
    tbl = table._tbl
    pr = tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), "4")
        e.set(qn("w:color"), color)
        b.append(e)
    pr.append(b)


def repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    e = OxmlElement("w:tblHeader")
    e.set(qn("w:val"), "true")
    trPr.append(e)


def no_split(row):
    trPr = row._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:cantSplit"))


def field(paragraph, code):
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, code), ("separate", None), ("end", None)):
        if kind:
            e = OxmlElement("w:fldChar")
            e.set(qn("w:fldCharType"), kind)
        else:
            e = OxmlElement("w:instrText")
            e.set(qn("xml:space"), "preserve")
            e.text = text
        run._r.append(e)
    return run


def add_inline(p, text, size=None, color=None, bold=False):
    """Adds text with `code` spans in a mono font."""
    for i, part in enumerate(re.split(r"`([^`]*)`", text)):
        if not part:
            continue
        r = p.add_run(part)
        r.font.name = MONO if i % 2 else FONT
        if size:
            r.font.size = size
        if color is not None:
            r.font.color.rgb = color
        r.bold = bold


doc = Document()
sec = doc.sections[0]
sec.page_height, sec.page_width = Cm(29.7), Cm(21.0)
sec.orientation = WD_ORIENT.PORTRAIT
sec.left_margin = sec.right_margin = Cm(1.8)
sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(1.8)

st = doc.styles["Normal"]
st.font.name, st.font.size = FONT, Pt(10)
st.font.color.rgb = INK
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
st.paragraph_format.space_after = Pt(4)
for name, size, before in (("Heading 1", 18, 18), ("Heading 2", 13, 12), ("Heading 3", 11, 10)):
    h = doc.styles[name]
    h.font.name, h.font.size, h.font.bold = FONT, Pt(size), True
    h.font.color.rgb = NAVY
    h.element.rPr.rFonts.set(qn("w:asciiTheme"), "")
    h.paragraph_format.space_before, h.paragraph_format.space_after = Pt(before), Pt(6)
    h.paragraph_format.keep_with_next = True

lines = open(SRC, encoding="utf-8").read().splitlines()
title = lines[0].lstrip("# ").strip()
date = lines[2].strip()

# Counts per area for the cover.
ids = re.findall(r"^\| ([A-Z]{1,2}-\d+) \|", "\n".join(lines), re.M)
total = len(ids)

# Header and footer.
hp = sec.header.paragraphs[0]
add_inline(hp, f"{title}", Pt(8), SLATE)
hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
fp = sec.footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
add_inline(fp, "Page ", Pt(8), SLATE)
field(fp, "PAGE").font.size = Pt(8)
add_inline(fp, " of ", Pt(8), SLATE)
field(fp, "NUMPAGES").font.size = Pt(8)
sec.different_first_page_header_footer = True

# Cover page.
for _ in range(6):
    doc.add_paragraph()
p = doc.add_paragraph()
r = p.add_run("Pakka")
r.font.size, r.bold, r.font.color.rgb, r.font.name = Pt(16), True, NAVY, FONT
p = doc.add_paragraph()
r = p.add_run(title)
r.font.size, r.bold, r.font.color.rgb, r.font.name = Pt(32), True, NAVY, FONT
p = doc.add_paragraph()
add_inline(p, SUBTITLE, Pt(12), SLATE)
doc.add_paragraph()
meta = doc.add_table(rows=0, cols=2)
borders(meta)
for k, v in (("Date", date), ("Checks", f"{total}"), ("Branch", BRANCH), ("Build under test", ""), ("Tester", ""), ("Status", "Draft")):
    row = meta.add_row()
    no_split(row)
    row.cells[0].width, row.cells[1].width = Cm(4), Cm(10)
    shade(row.cells[0], "EBF0F8")
    add_inline(row.cells[0].paragraphs[0], k, Pt(10), NAVY, True)
    add_inline(row.cells[1].paragraphs[0], v, Pt(10))
for j, gc in enumerate(meta._tbl.tblGrid.findall(qn("w:gridCol"))):
    gc.set(qn("w:w"), str([4, 10][j] * 567))
doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

# Contents.
doc.add_heading("Contents", level=1)
p = doc.add_paragraph()
field(p, 'TOC \\o "1-3" \\h \\z \\u')
p = doc.add_paragraph()
add_inline(p, "In Word, right-click the contents and choose Update field to fill in page numbers.", Pt(8), SLATE)
doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

# Body.
i = 3
first_h1 = True


def flush_table(rows):
    header = [c.strip() for c in rows[0].strip("|").split("|")]
    body = [[c.strip() for c in r.strip("|").split("|")] for r in rows[2:]]
    is_checks = header[0] == "ID"
    if is_checks:
        header = header + ["Result"]
        body = [r + [""] for r in body]
    n = len(header)
    widths_cm = {
        5: [1.4, 3.4, 5.4, 5.6, 1.6],
        4: [1.4, 4.6, 9.8, 1.6] if is_checks else [3.5, 5, 9],
        3: [2.5, 11.6, 3.3],
        6: [3.6, 2.8, 2.8, 2.2, 2.0, 4.0],
        2: [4.2, 13.2],
    }
    w = widths_cm.get(n, [17.4 / n] * n)
    if n == 4 and not is_checks:
        w = [1.4, 5.5, 10.5]
    if n == 3 and header[0] == "Level":
        w = [1.4, 8, 8]
    if n == 3 and header[0] == "Finding":
        w = [1.8, 12.4, 3.2]
    t = doc.add_table(rows=1, cols=n)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    borders(t)
    hdr = t.rows[0]
    repeat_header(hdr)
    for j, h in enumerate(header):
        c = hdr.cells[j]
        shade(c, "002E6E")
        add_inline(c.paragraphs[0], h, Pt(9), RGBColor(0xFF, 0xFF, 0xFF), True)
    for k, r in enumerate(body):
        row = t.add_row()
        no_split(row)
        for j in range(n):
            c = row.cells[j]
            if k % 2:
                shade(c, "F4F8FD")
            txt = r[j] if j < len(r) else ""
            add_inline(c.paragraphs[0], txt, Pt(8.5), NAVY if j == 0 else None, j == 0)
    # Fixed layout plus grid widths, so Word, Pages and Google Docs all keep the column sizes.
    pr = t._tbl.tblPr
    lay = OxmlElement("w:tblLayout"); lay.set(qn("w:type"), "fixed"); pr.append(lay)
    tw = OxmlElement("w:tblW"); tw.set(qn("w:w"), str(int(sum(w[:n]) * 567))); tw.set(qn("w:type"), "dxa"); pr.append(tw)
    for j, gc in enumerate(t._tbl.tblGrid.findall(qn("w:gridCol"))):
        gc.set(qn("w:w"), str(int((w[j] if j < len(w) else 2) * 567)))
    for row in t.rows:
        for j, c in enumerate(row.cells):
            c.width = Cm(w[j] if j < len(w) else 2)
            for para in c.paragraphs:
                para.paragraph_format.space_after = Pt(1)
    doc.add_paragraph()


while i < len(lines):
    line = lines[i]
    if line.startswith("|"):
        block = []
        while i < len(lines) and lines[i].startswith("|"):
            block.append(lines[i])
            i += 1
        flush_table(block)
        continue
    if line.startswith("## "):
        if not first_h1:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        first_h1 = False
        doc.add_heading(line[3:].strip(), level=1)
    elif line.startswith("### "):
        doc.add_heading(line[4:].strip(), level=2)
    elif line.startswith("#### "):
        doc.add_heading(line[5:].strip(), level=3)
    elif line.startswith("- [ ] "):
        p = doc.add_paragraph()
        add_inline(p, "☐  " + line[6:])
        p.paragraph_format.left_indent = Cm(0.5)
    elif line.startswith("- "):
        p = doc.add_paragraph(style="List Bullet")
        add_inline(p, line[2:])
    elif line.strip():
        add_inline(doc.add_paragraph(), line.strip())
    i += 1

doc.core_properties.title = title
doc.core_properties.author = "Pakka team"
doc.save(OUT)
print(f"{total} checks -> {OUT}")
