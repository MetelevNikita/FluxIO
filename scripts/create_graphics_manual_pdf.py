from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "FluxIO_Graphics_Engine_v7.0.14_RU.pdf"
ASSETS = ROOT / "output" / "pdf" / "assets"
W, H = landscape(A4)

BG = HexColor("#080B10")
SURFACE = HexColor("#101722")
SURFACE_2 = HexColor("#151E2C")
BORDER = HexColor("#2A374A")
TEXT = HexColor("#F1F4F8")
MUTED = HexColor("#9AA8BB")
DIM = HexColor("#66758A")
ACCENT = HexColor("#FFD54D")
BLUE = HexColor("#5B8CFF")
TEAL = HexColor("#55D6C2")
GREEN = HexColor("#52D6A5")
ORANGE = HexColor("#FF9D52")
RED = HexColor("#FF6B72")


pdfmetrics.registerFont(TTFont("Arial", "/System/Library/Fonts/Supplemental/Arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Italic", "/System/Library/Fonts/Supplemental/Arial Italic.ttf"))


def rounded(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill, stroke=BORDER, radius=8):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def page_base(c: canvas.Canvas, title: str, section: str, number: int):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.roundRect(28, H - 48, 22, 22, 5, fill=1, stroke=0)
    c.setFillColor(BG)
    c.setFont("Arial-Bold", 10)
    c.drawCentredString(39, H - 41, "F")
    c.setFillColor(DIM)
    c.setFont("Arial-Bold", 7)
    c.drawString(60, H - 35, section.upper())
    c.setFillColor(TEXT)
    c.setFont("Arial-Bold", 18)
    c.drawString(60, H - 53, title)
    c.setStrokeColor(BORDER)
    c.line(28, 28, W - 28, 28)
    c.setFillColor(DIM)
    c.setFont("Arial", 7)
    c.drawString(28, 16, "FluxIO Graphics Engine · v7.0.14 · 21.08.2026")
    c.drawRightString(W - 28, 16, f"{number:02d}")


def fit_lines(text: str, font: str, size: float, width: float):
    words = text.split()
    lines, current = [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def paragraph(c, text, x, y, width, size=9, color=MUTED, leading=None, font="Arial"):
    leading = leading or size * 1.42
    c.setFont(font, size)
    c.setFillColor(color)
    for line in fit_lines(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def bullets(c, items, x, y, width, size=8.5, color=MUTED, gap=4):
    for item in items:
        c.setFillColor(TEAL)
        c.circle(x + 3, y + 3, 2, fill=1, stroke=0)
        y = paragraph(c, item, x + 14, y, width - 14, size, color) - gap
    return y


def label(c, text, x, y, color=BLUE):
    c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.14))
    c.setStrokeColor(color)
    width = pdfmetrics.stringWidth(text, "Arial-Bold", 7) + 14
    c.roundRect(x, y - 3, width, 16, 4, fill=1, stroke=1)
    c.setFillColor(color)
    c.setFont("Arial-Bold", 7)
    c.drawString(x + 7, y + 2, text)
    return width


def card_title(c, number, title, subtitle, x, y, width):
    c.setFillColor(BLUE)
    c.setFont("Arial-Bold", 7)
    c.drawString(x, y, number)
    c.setFillColor(TEXT)
    c.setFont("Arial-Bold", 11)
    c.drawString(x + 25, y, title)
    c.setFillColor(DIM)
    c.setFont("Arial", 7)
    c.drawString(x + 25, y - 13, subtitle)


def draw_image_contain(c, path: Path, x, y, w, h, border=True):
    image = ImageReader(str(path))
    iw, ih = image.getSize()
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    if border:
        rounded(c, x, y, w, h, SURFACE, BORDER, 7)
    c.drawImage(image, dx, dy, dw, dh, preserveAspectRatio=True, mask="auto")


def arrow(c, x1, y1, x2, y2, color=BLUE):
    c.setStrokeColor(color)
    c.setLineWidth(1.5)
    c.line(x1, y1, x2, y2)
    c.setFillColor(color)
    c.saveState()
    c.translate(x2, y2)
    c.rotate(0 if x2 >= x1 else 180)
    c.line(-7, 4, 0, 0)
    c.line(-7, -4, 0, 0)
    c.restoreState()


def flow_box(c, x, y, w, h, kicker, title, note, color=BLUE):
    rounded(c, x, y, w, h, SURFACE, color, 7)
    c.setFillColor(color)
    c.setFont("Arial-Bold", 6.5)
    c.drawString(x + 11, y + h - 16, kicker.upper())
    c.setFillColor(TEXT)
    c.setFont("Arial-Bold", 9)
    c.drawString(x + 11, y + h - 32, title)
    paragraph(c, note, x + 11, y + h - 47, w - 22, 6.8, DIM, 9)


def code_block(c, text, x, y, w, h):
    rounded(c, x, y, w, h, HexColor("#090D13"), BORDER, 6)
    c.setFillColor(TEAL)
    # Arial сохраняет кириллицу; моноширинный Courier из Base-14 её не содержит.
    c.setFont("Arial", 7.2)
    ty = y + h - 15
    for line in text.splitlines():
        c.drawString(x + 10, ty, line)
        ty -= 10


def effect_page(c, number, name, purpose, source, setup, output, notes, color, diagram_kind):
    page_base(c, name, "Стандартные эфирные эффекты", number)
    label(c, "LEVEL 2 · PARAMETRIC", 60, H - 82, color)
    paragraph(c, purpose, 60, H - 112, 710, 11, TEXT, 15, "Arial-Bold")

    rounded(c, 42, 245, 360, 220, SURFACE, BORDER, 8)
    card_title(c, "01", "Как работает", "Логика эффекта", 58, 440, 320)
    bullets(c, output, 58, 400, 320, 8.3)

    rounded(c, 420, 245, 380, 220, SURFACE, BORDER, 8)
    card_title(c, "02", "Как настроить", source, 436, 440, 340)
    bullets(c, setup, 436, 400, 340, 8.3)

    rounded(c, 42, 54, 758, 168, SURFACE_2, BORDER, 8)
    c.setFillColor(color)
    c.setFont("Arial-Bold", 8)
    c.drawString(58, 201, "СХЕМА В ЭФИРЕ")
    draw_effect_diagram(c, 58, 73, 456, 102, diagram_kind, color)
    c.setFillColor(TEXT)
    c.setFont("Arial-Bold", 9)
    c.drawString(545, 184, "Важно")
    bullets(c, notes, 545, 161, 230, 7.7, MUTED, 3)
    c.showPage()


def draw_effect_diagram(c, x, y, w, h, kind, color):
    c.setStrokeColor(BORDER)
    c.setLineWidth(7)
    c.line(x, y + h / 2, x + w, y + h / 2)
    c.setFillColor(DIM)
    c.setFont("Arial", 6.5)
    c.drawString(x, y + 12, "IN ролика")
    c.drawRightString(x + w, y + 12, "OUT ролика")
    if kind == "inout":
        c.setFillColor(color)
        c.roundRect(x + 35, y + h / 2 - 12, 95, 24, 5, fill=1, stroke=0)
        c.roundRect(x + w - 130, y + h / 2 - 12, 95, 24, 5, fill=1, stroke=0)
        c.setFillColor(BG); c.setFont("Arial-Bold", 7)
        c.drawCentredString(x + 82, y + h / 2 - 2, "ANIMATION IN")
        c.drawCentredString(x + w - 82, y + h / 2 - 2, "ANIMATION OUT")
    elif kind in {"title", "ticker", "clock"}:
        start = x + 75
        width = 265 if kind != "title" else 180
        c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.18))
        c.setStrokeColor(color)
        c.roundRect(start, y + h / 2 - 28, width, 56, 8, fill=1, stroke=1)
        c.setFillColor(TEXT); c.setFont("Arial-Bold", 8)
        text = {"title": "АНИМИРОВАННАЯ ПЛАШКА", "ticker": "БЕГУЩАЯ СТРОКА → → →", "clock": "12:45:31 / 00:00:29"}[kind]
        c.drawCentredString(start + width / 2, y + h / 2 - 3, text)
    elif kind == "next":
        c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.18))
        c.setStrokeColor(color)
        c.roundRect(x + w - 190, y + h / 2 - 28, 150, 56, 8, fill=1, stroke=1)
        c.setFillColor(TEXT); c.setFont("Arial-Bold", 8)
        c.drawCentredString(x + w - 115, y + h / 2 - 3, "СМОТРИТЕ ДАЛЕЕ")
        c.setStrokeColor(ORANGE); c.setLineWidth(2); c.line(x + w - 40, y + 12, x + w - 40, y + h - 12)
    elif kind == "stinger":
        cut = x + w / 2
        c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.25))
        c.wedge(cut - 95, y + h / 2 - 42, cut + 5, y + h / 2 + 42, 90, 180, fill=1, stroke=0)
        c.wedge(cut - 5, y + h / 2 - 42, cut + 95, y + h / 2 + 42, 270, 180, fill=1, stroke=0)
        c.setStrokeColor(ORANGE); c.setLineWidth(2); c.line(cut, y + 4, cut, y + h - 4)
        c.setFillColor(ORANGE); c.setFont("Arial-Bold", 7); c.drawCentredString(cut, y + 10, "CUT POINT")


def make_pdf():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("FluxIO Graphics Engine v7.0.14 — JSON Parser и эфирные эффекты")
    c.setAuthor("FluxIO")

    # 1 — cover
    c.setFillColor(BG); c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(Color(BLUE.red, BLUE.green, BLUE.blue, alpha=0.12)); c.circle(W - 70, H - 65, 230, fill=1, stroke=0)
    c.setFillColor(Color(TEAL.red, TEAL.green, TEAL.blue, alpha=0.10)); c.circle(65, 25, 180, fill=1, stroke=0)
    label(c, "OPERATOR + ENGINEERING GUIDE", 58, H - 78, TEAL)
    c.setFillColor(TEXT); c.setFont("Arial-Bold", 32); c.drawString(58, H - 145, "FluxIO Graphics Engine")
    c.setFillColor(BLUE); c.setFont("Arial-Bold", 24); c.drawString(58, H - 180, "JSON Parser · responsive templates · effects")
    paragraph(c, "Полное руководство по подключению данных, пользовательским Lottie-шаблонам и настройке стандартной эфирной графики.", 58, H - 225, 570, 13, MUTED, 19)
    rounded(c, 58, 92, 650, 120, SURFACE, BORDER, 10)
    cards = [("01", "JSON → Text Layer"), ("02", "fit: responsive plate"), ("03", "6 эфирных эффектов"), ("04", "операторский workflow")]
    for i, (num, txt) in enumerate(cards):
        xx = 76 + i * 155
        c.setFillColor(TEAL if i < 2 else BLUE); c.setFont("Arial-Bold", 8); c.drawString(xx, 176, num)
        paragraph(c, txt, xx, 154, 130, 9, TEXT, 12, "Arial-Bold")
    c.setFillColor(DIM); c.setFont("Arial", 8); c.drawString(58, 55, "FluxIO v7.0.14 · документ для оператора эфира, дизайнера и инженера внедрения")
    c.showPage()

    # 2 — result
    page_base(c, "Что реализовано в v7.0.14", "Обзор", 2)
    paragraph(c, "Новый слой данных отделяет структуру внешнего JSON от структуры графического шаблона. Оператор видит связи до выхода в эфир, а дизайнер отвечает только за визуал и имена Text Layer.", 60, H - 92, 700, 11, TEXT, 16)
    items = [
        ("JSON Parser", "Один объект или массив до 2000 записей; строки, числа, boolean, вложенные dotted keys."),
        ("Mapping", "Произвольный source key → любой редактируемый Text Layer; mapping сохраняется с эффектом."),
        ("Responsive FIT", "Автоматическое обнаружение `fit:<Text Layer>` и пересчёт ширины под реальный текст."),
        ("Custom templates", "Любой импортированный Lottie доступен как шаблон всех текстовых эффектов."),
        ("Unified UI", "Поток настройки: Шаблон → Данные → Эфир → Оформление."),
        ("Safe rendering", "Живые часы/строка остаются drawtext; Lottie отвечает за декор и адаптивную подложку."),
    ]
    for idx, (title, note) in enumerate(items):
        col, row = idx % 3, idx // 3
        x, y = 42 + col * 258, 315 - row * 150
        rounded(c, x, y, 238, 125, SURFACE, BORDER, 8)
        c.setFillColor(TEAL if idx in {0,2,4} else BLUE); c.setFont("Arial-Bold", 8); c.drawString(x + 14, y + 94, f"0{idx+1}")
        c.setFillColor(TEXT); c.setFont("Arial-Bold", 11); c.drawString(x + 14, y + 72, title)
        paragraph(c, note, x + 14, y + 52, 207, 7.8, MUTED, 11)
    c.showPage()

    # 3 — architecture
    page_base(c, "Архитектура: данные отдельно, графика отдельно", "Система", 3)
    paragraph(c, "В эфир попадает не JSON и не проект After Effects, а заранее разрешённый план: alpha-слой + живой текст + параметры времени.", 60, H - 88, 700, 10, MUTED, 14)
    x0, y0, bw, bh, gap = 42, 305, 135, 120, 22
    flow = [
        ("SOURCE", "Newsroom JSON", "MAM, расписание, ручной файл", TEAL),
        ("PARSE", "JSON Parser", "flatten, samples, warnings", BLUE),
        ("BIND", "Saved mapping", "match key + field bindings", BLUE),
        ("PLAN", "Effect planner", "условия, окно, next clip", ORANGE),
        ("AIR", "FFmpeg graph", "alpha overlay + drawtext", GREEN),
    ]
    for i, item in enumerate(flow):
        x = x0 + i * (bw + gap)
        flow_box(c, x, y0, bw, bh, *item)
        if i < len(flow) - 1: arrow(c, x + bw + 3, y0 + bh/2, x + bw + gap - 3, y0 + bh/2)
    rounded(c, 95, 90, 650, 150, SURFACE_2, BORDER, 8)
    c.setFillColor(TEXT); c.setFont("Arial-Bold", 10); c.drawString(115, 215, "Гибридный кадр")
    flow_box(c, 115, 115, 170, 72, "LAYER A", "Lottie / alpha", "анимация, декор, подложка", BLUE)
    c.setFillColor(ACCENT); c.setFont("Arial-Bold", 18); c.drawCentredString(320, 145, "+")
    flow_box(c, 350, 115, 170, 72, "LAYER B", "FFmpeg drawtext", "живой текст, часы, ticker", TEAL)
    c.setFillColor(ACCENT); c.setFont("Arial-Bold", 18); c.drawCentredString(555, 145, "=")
    flow_box(c, 585, 115, 140, 72, "OUTPUT", "Program video", "UDP / SRT / RTMP", GREEN)
    c.showPage()

    # 4 — UI screenshot
    page_base(c, "Новый Graphics UI", "Операторский workflow", 4)
    paragraph(c, "Инспектор больше не смешивает всё в один список: сверху выбранный шаблон и данные, затем поведение эффекта и оформление.", 60, H - 88, 700, 10, MUTED, 14)
    draw_image_contain(c, ASSETS / "graphics-studio-full.png", 42, 92, 520, 390)
    rounded(c, 585, 92, 215, 390, SURFACE, BORDER, 8)
    steps = [
        ("01", "Шаблон", "Импорт Lottie или штатная графика."),
        ("02", "Данные", "JSON Parser, match key и mapping."),
        ("03", "Эфир", "Источник, timing, условия, repeat."),
        ("04", "Оформление", "Шрифт, цвет, положение и preview."),
    ]
    yy = 435
    for num, title, note in steps:
        c.setFillColor(BLUE); c.setFont("Arial-Bold", 8); c.drawString(603, yy, num)
        c.setFillColor(TEXT); c.setFont("Arial-Bold", 10); c.drawString(632, yy, title)
        yy = paragraph(c, note, 632, yy - 17, 145, 7.5, MUTED, 10) - 22
    c.showPage()

    # 5 — parser screenshot
    page_base(c, "JSON Parser: три решения в одном окне", "Данные", 5)
    draw_image_contain(c, ASSETS / "json-parser.png", 42, 190, 758, 330)
    columns = [
        ("01 · MATCH", "Выберите поле, которое идентифицирует ролик. Значение должно совпасть с именем материала."),
        ("02 · BIND", "Свяжите каждый source key с Text Layer. Auto map помогает при совпадающих именах."),
        ("03 · VERIFY", "Проверьте первые три записи, заполненность и статус FIT до сохранения."),
    ]
    for i, (title, note) in enumerate(columns):
        x = 42 + i * 258
        rounded(c, x, 52, 238, 116, SURFACE, BORDER, 7)
        c.setFillColor(TEAL); c.setFont("Arial-Bold", 8); c.drawString(x + 13, 141, title)
        paragraph(c, note, x + 13, 120, 208, 7.6, MUTED, 10.5)
    c.showPage()

    # 6 — responsive background
    page_base(c, "Отзывчивая подложка: как работает FIT", "Templates", 6)
    paragraph(c, "Lottie сам не выполняет layout. FluxIO измеряет реальную строку метриками выбранного шрифта и меняет Rectangle Size перед рендером.", 60, H - 88, 700, 10, MUTED, 14)
    rounded(c, 42, 300, 758, 170, SURFACE, BORDER, 8)
    c.setFillColor(TEXT); c.setFont("Arial-Bold", 10); c.drawString(60, 442, "Один шаблон — разные значения")
    examples = [("LIVE", 130), ("ВЕЧЕРНИЕ НОВОСТИ", 250), ("ДО КОНЦА ПЕРЕДАЧИ 00:04:21", 360)]
    yy = 392
    for text, width in examples:
        c.setFillColor(Color(BLUE.red, BLUE.green, BLUE.blue, alpha=0.28)); c.setStrokeColor(BLUE)
        c.roundRect(62, yy - 16, width, 34, 9, fill=1, stroke=1)
        c.setFillColor(TEXT); c.setFont("Arial-Bold", 9); c.drawString(78, yy - 4, text)
        c.setFillColor(DIM); c.setFont("Arial", 7); c.drawString(445, yy - 4, f"Rectangle width = text width + исходные padding")
        yy -= 48
    rounded(c, 42, 62, 365, 210, SURFACE_2, BORDER, 8)
    card_title(c, "AE", "Что сделать дизайнеру", "After Effects / Bodymovin", 58, 240, 320)
    bullets(c, [
        "Text Layer назвать стабильно: например `main_title`.",
        "Shape Layer с Rectangle назвать `fit:main_title`.",
        "Шаблонный текст задать средней длины — по нему сохраняется padding.",
        "Не превращать текст в shapes, если поле должно быть изменяемым.",
        "Экспортировать прозрачный Lottie; новый текст должен поддерживаться шрифтом.",
    ], 58, 204, 320, 8)
    rounded(c, 435, 62, 365, 210, SURFACE_2, BORDER, 8)
    card_title(c, "AIR", "Что делает FluxIO", "До запуска эфирного renderer", 451, 240, 320)
    bullets(c, [
        "Находит пары `fit:` при анализе и показывает FIT READY.",
        "Берёт метрики cmap/hmtx конкретного файла шрифта.",
        "Сохраняет левую, правую или центральную выключку.",
        "Для часов использует самый широкий sample выбранного формата.",
        "Рендерит варианты в кэш и повторно использует одинаковые значения.",
    ], 451, 204, 320, 8)
    c.showPage()

    # 7 — custom template
    page_base(c, "Пользовательский шаблон: минимальный контракт", "Templates", 7)
    paragraph(c, "Отдельный manifest не нужен: редактируемые поля обнаруживаются прямо в Lottie. Для alpha-MOV/GIF текстовых полей нет — это готовая картинка.", 60, H - 88, 700, 10, MUTED, 14)
    code_block(c, "Composition\n├─ DECOR / animation\n├─ fit:main_title   ← Shape Layer + Rectangle\n├─ main_title       ← Text Layer (editable)\n├─ kicker           ← Text Layer (editable)\n└─ icon / optional", 42, 258, 355, 220)
    rounded(c, 420, 258, 380, 220, SURFACE, BORDER, 8)
    card_title(c, "CHECK", "Перед передачей шаблона", "Совместимость с эфиром", 438, 447, 340)
    bullets(c, [
        "Имена Text Layer уникальны и не меняются между версиями.",
        "У `fit:` есть неанимированный Rectangle Size; сложный path не растягивается.",
        "Шрифт установлен на media-service и содержит кириллицу.",
        "Динамическое поле выбрано в Inspector; шаблонный текст будет очищен.",
        "Входная анимация заканчивается до основного состояния, выходная — до конца файла.",
    ], 438, 409, 330, 8)
    rounded(c, 42, 62, 758, 165, SURFACE_2, BORDER, 8)
    c.setFillColor(TEAL); c.setFont("Arial-Bold", 8); c.drawString(60, 202, "ПОДДЕРЖКА ПО ФОРМАТАМ")
    rows = [
        ("Lottie JSON", "Да", "Да (`fit:`)", "Изменяемые поля + анимация"),
        ("MOV/WebM alpha", "Нет", "Нет", "Готовый слой, допускается loop/hold"),
        ("GIF", "Нет", "Нет", "Готовая циклическая графика"),
        ("Native drawtext", "Да", "Да (box/padding)", "Без Lottie, максимально надёжно"),
    ]
    headers = ["Источник", "Текст", "Responsive", "Назначение"]
    xs = [60, 240, 330, 450]
    for x, head in zip(xs, headers): c.setFillColor(DIM); c.setFont("Arial-Bold", 7); c.drawString(x, 180, head)
    yy = 158
    for row in rows:
        for x, value in zip(xs, row): c.setFillColor(TEXT if x == 60 else MUTED); c.setFont("Arial", 7.5); c.drawString(x, yy, value)
        yy -= 23
    c.showPage()

    effect_page(c, 8, "Animation in/out", "Показывает персонализированную входную и/или выходную анимацию на выбранных роликах.", "Lottie + optional JSON", [
        "Выберите обязательный Lottie-шаблон.", "Задайте In, Out или In+Out; Start/End и Duration.", "В JSON Parser выберите идентификатор ролика и свяжите все нужные Text Layer.", "Примените ко всему проекту или выбранному материалу.",
    ], [
        "Окно IN считается от начала ролика.", "Окно OUT считается от конца эфирной длительности.", "Каждая запись JSON создаёт overrides конкретного шаблона.",
    ], ["Дублирующееся имя ролика делает привязку неоднозначной.", "Без JSON шаблон применяется с исходными значениями."], BLUE, "inout")

    effect_page(c, 9, "Dynamic title", "Универсальная анимированная плашка для имени, статуса, географии, счётчика или произвольного заголовка.", "Manual text или JSON", [
        "Выберите Lottie-плашку или штатную надпись.", "Укажите manual/task-file, Start и Duration.", "Выберите Text Layer для живого текста; JSON mapping направьте в то же поле.", "Выберите системный шрифт с нужным алфавитом.",
    ], [
        "Lottie рисует появление, декор и подложку.", "Реальный текст рисует FFmpeg и остаётся резким.", "FIT sample растягивает подложку под значение каждого ролика.",
    ], ["Fallback используется, если ключ отсутствует.", "Изменение настроек нужно сохранить и переприменить к назначенным роликам."], TEAL, "title")

    effect_page(c, 10, "Next program", "Показывает название следующего фильма перед концом текущего материала.", "Playlist name или JSON", [
        "Задайте Start offset до конца и Duration.", "Выберите источник: имя следующего фильма или task-file.", "Свяжите JSON с Text Layer названия и, при необходимости, подзаголовка.", "Задайте fallback для последнего фильма.",
    ], [
        "Ищется следующий элемент типа movie; отбивки пропускаются.", "Название остаётся живым drawtext.", "Подложка пересчитывается по имени следующего фильма.",
    ], ["На последнем ролике без fallback эффект пропускается.", "Start offset должен помещаться в длительность текущего ролика."], ORANGE, "next")

    effect_page(c, 11, "Ticker crawl", "Бегущая строка с постоянной скоростью независимо от длины сообщения и разрешения программы.", "Manual / JSON-TXT / RSS-Atom", [
        "Выберите источник сообщений и разделитель.", "Задайте скорость px/s, направление, repeat, Start и Duration.", "Ограничьте X и Width полосы по размеру подложки.", "JSON mapping можно использовать для постоянных Text Layer шаблона.",
    ], [
        "Текст рисуется на прозрачном холсте заданной ширины.", "Холст обрезает строку по границам плашки.", "Lottie отвечает за фон, подпись и анимацию появления.",
    ], ["При Width=100% строка идёт по всему кадру.", "RSS загружается media-service; обновление запускается вручную."], BLUE, "ticker")

    effect_page(c, 12, "Clock / countdown", "Экранные часы по эфирному времени или обратный отсчёт — в том числе ровно до конца текущего ролика.", "Air clock / fixed / clip remaining", [
        "Выберите Clock или Countdown и формат.", "Для часов задайте UTC offset; для countdown — fixed или clip remaining.", "Выберите Text Layer для живого значения.", "Для FIT назовите подложку `fit:<поле>`; ширина берётся по widest sample.",
    ], [
        "Время строится от airEpoch, а не от момента запуска preloaded renderer.", "FFmpeg обновляет значение покадрово.", "Lottie-подложка рендерится один раз по максимальной ширине формата.",
    ], ["Нужен FFmpeg с libfreetype/drawtext.", "Для кириллицы в подписи выберите совместимый font file."], TEAL, "clock")

    effect_page(c, 13, "Stinger transition", "Брендированный переход, который перекрывает стык двух независимых renderer без изменения расписания.", "Lottie или alpha MOV/WebM", [
        "Выберите Lottie-пресет либо файл с alpha/luma.", "Задайте полную Duration и Cut point полного перекрытия.", "Выберите alpha или luma threshold.", "Опционально включите звук и его уровень.",
    ], [
        "Часть [0, cut) ложится на хвост A.", "Часть [cut, duration) берётся из того же файла и ложится на голову B.", "Cut и длительности округляются по кадровой сетке.",
    ], ["JSON mapping не показывается: stinger не является текстовой плашкой.", "Cut point обязан находиться внутри duration."], RED, "stinger")

    # 14 — hot loader
    page_base(c, "Hot Loader: что меняется на лету", "Эксплуатация", 14)
    paragraph(c, "Важно различать обновление будущих рендеров и изменение уже кодируемого кадра. Текущая версия безопасно перестраивает назначения, не вмешиваясь в долгоживущий program encoder.", 60, H - 90, 700, 10, MUTED, 14)
    rounded(c, 42, 285, 365, 205, SURFACE, GREEN, 8)
    label(c, "AVAILABLE v7.0.14", 60, 455, GREEN)
    bullets(c, [
        "Перечитать JSON и изменить mapping.", "Сохранить настройки эффекта и пересобрать его слои на назначенных роликах.", "Применить HOT CHANGE плейлиста без остановки транспортной сессии.", "Новые значения попадут в ещё не запущенные renderer текущего и Future расписания.",
    ], 60, 420, 320, 8.5)
    rounded(c, 435, 285, 365, 205, SURFACE, ORANGE, 8)
    label(c, "NEXT CG ENGINE", 453, 455, ORANGE)
    bullets(c, [
        "Покадровая замена текста внутри уже активного ролика.", "Отдельный persistent CG compositor поверх program encoder.", "Watch folder / webhook / websocket для автоматического reload.", "Take/Preview/Program модель и журнал действий оператора.",
    ], 453, 420, 320, 8.5)
    rounded(c, 42, 62, 758, 190, SURFACE_2, BORDER, 8)
    flow_box(c, 65, 118, 145, 78, "OPERATOR", "Reload JSON", "новые записи и mapping", TEAL)
    arrow(c, 218, 157, 270, 157)
    flow_box(c, 278, 118, 145, 78, "PLAN", "Rebuild FX", "future clip renderers", BLUE)
    arrow(c, 431, 157, 483, 157)
    flow_box(c, 491, 118, 145, 78, "HOT CHANGE", "Playlist PUT", "без сброса UDP/SRT", ORANGE)
    arrow(c, 644, 157, 690, 157)
    c.setFillColor(GREEN); c.circle(720, 157, 25, fill=1, stroke=0); c.setFillColor(BG); c.setFont("Arial-Bold", 8); c.drawCentredString(720, 154, "AIR")
    c.showPage()

    # 15 — JSON example and checklist
    page_base(c, "Рабочий пример и чек-лист перед эфиром", "Runbook", 15)
    code_block(c, '''[
  {
    "media": { "name": "news_2100.mp4" },
    "programme": {
      "title": "Вечерние новости",
      "status": "ПРЯМОЙ ЭФИР"
    },
    "episode": 42,
    "live": true
  }
]''', 42, 225, 345, 270)
    rounded(c, 410, 225, 390, 270, SURFACE, BORDER, 8)
    card_title(c, "MAP", "Mapping этого файла", "То, что сохраняется в эффекте", 428, 465, 340)
    rows = [
        ("MATCH", "media.name", "имя ролика"),
        ("BIND", "programme.title", "main_title"),
        ("BIND", "programme.status", "kicker"),
        ("BIND", "episode", "episode_number"),
    ]
    yy = 420
    for tag, source, target in rows:
        label(c, tag, 428, yy, TEAL if tag == "MATCH" else BLUE)
        c.setFillColor(TEXT); c.setFont("Arial", 8); c.drawString(500, yy + 2, source)
        c.setFillColor(DIM); c.drawString(625, yy + 2, "→")
        c.setFillColor(MUTED); c.drawString(648, yy + 2, target)
        yy -= 43
    rounded(c, 42, 54, 758, 145, SURFACE_2, BORDER, 8)
    c.setFillColor(ACCENT); c.setFont("Arial-Bold", 8); c.drawString(58, 175, "ПЕРЕД START / HOT CHANGE")
    checks = [
        "JSON Parser: match key заполнен, preview строк соответствует плейлисту.",
        "У динамического Text Layer выбран font file с нужным алфавитом.",
        "FIT READY виден у поля, которое должно менять ширину подложки.",
        "Timing помещается в эфирную длительность ролика; stinger cut находится внутри duration.",
        "Save применён к уже назначенным роликам; Preview проверен на коротком и длинном тексте.",
        "Media-service перезапущен после обновления версии контрактов.",
    ]
    for i, item in enumerate(checks):
        col, row = i % 2, i // 2
        x, y = 58 + col * 370, 147 - row * 32
        c.setStrokeColor(GREEN); c.rect(x, y - 2, 9, 9, fill=0, stroke=1)
        paragraph(c, item, x + 17, y, 330, 7.2, MUTED, 9)
    c.showPage()

    c.save()
    print(OUT)


if __name__ == "__main__":
    make_pdf()
