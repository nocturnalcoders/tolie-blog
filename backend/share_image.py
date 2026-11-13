"""Share pictures for a post, drawn in the blog's night-sky style.

  card  1200 x 630   the link preview on LinkedIn, WhatsApp, X, ... (og:image)
  story 1080 x 1920  for Instagram and TikTok stories, which can't share links from a website
"""
from __future__ import annotations

import io
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parent / "assets"
SIZES = {"card": (1200, 630), "story": (1080, 1920)}

SKY = ((10, 16, 48), (29, 42, 102), (59, 75, 147))
CARD = (255, 246, 226)
LINE = (90, 59, 46)
INK = (52, 36, 58)
INK_SOFT = (107, 90, 96)
CORAL = (232, 116, 79)
AMBER = (255, 210, 122)
MOON = (255, 247, 207)
STARS = [(.22, .30), (.35, .06), (.47, .22), (.58, .10), (.66, .28), (.74, .06), (.95, .40),
         (.14, .52), (.82, .58), (.03, .70), (.30, .93), (.62, .90)]


@lru_cache(maxsize=16)
def font(size: int, weight: str = "SemiBold") -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(ASSETS / "Fredoka.ttf"), size)
    f.set_variation_by_name(weight)
    return f


def sky(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    px = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        a, b, k = (SKY[0], SKY[1], t / .48) if t < .48 else (SKY[1], SKY[2], (t - .48) / .52)
        px.line([(0, y), (w, y)], fill=tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(3)))
    for sx, sy in STARS:
        x, y = sx * w, sy * h
        px.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(255, 255, 255))
    mx, my, r = w * .86, h * .12, min(w, h) * .05
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([mx - r * 2.1, my - r * 2.1, mx + r * 2.1, my + r * 2.1], fill=(*MOON, 46))
    img.paste(glow, (0, 0), glow)
    px.ellipse([mx - r, my - r, mx + r, my + r], fill=MOON)
    return img


def wrap(text: str, f: ImageFont.FreeTypeFont, width: int, max_lines: int) -> list[str]:
    lines: list[str] = []
    for word in text.split():
        if lines and f.getlength(f"{lines[-1]} {word}") <= width:
            lines[-1] += f" {word}"
        else:
            lines.append(word)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and f.getlength(lines[-1] + "…") > width:
            lines[-1] = lines[-1][:-1]
        lines[-1] = lines[-1].rstrip() + "…"
    return lines


def fit_title(title: str, width: int, sizes: tuple[int, ...], max_lines: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    for size in sizes:  # the biggest size that fits, so short titles get big type
        f = font(size)
        lines = wrap(title, f, width, 99)
        if len(lines) <= max_lines:
            return f, lines
    f = font(sizes[-1])
    return f, wrap(title, f, width, max_lines)


def avatar(size: int) -> Image.Image:
    img = Image.open(ASSETS / "avatar.jpg").convert("RGB").resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    ring = Image.new("RGBA", (size + 16, size + 16), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([0, 0, size + 15, size + 15], fill=AMBER)
    ring.paste(img, (8, 8), mask)
    return ring


def render(kind: str, title: str, meta: str, tags: list[str], site: str) -> bytes:
    w, h = SIZES[kind]
    img = sky(w, h)
    d = ImageDraw.Draw(img)
    tag = (tags[0] if tags else "note")[:24]

    if kind == "card":
        box = (60, 140, w - 60, h - 60)
        pad, text_w = 56, w - 120 - 112
        d.text((60, 36), "tolie.space", font=font(34), fill=MOON)
        d.text((60 + font(34).getlength("tolie.space") + 12, 46), "/ notes", font=font(24, "Regular"), fill=(185, 180, 207))
        f, lines = fit_title(title, text_w, (64, 56, 50, 44), 3)
        meta_size, gap = 26, 18
    else:
        box = (70, 520, w - 70, 1500)
        pad, text_w = 70, w - 140 - 140
        av = avatar(180)
        img.paste(av, ((w - av.width) // 2, 230), av)
        brand = "tolie.space / notes"
        d.text(((w - font(44).getlength(brand)) / 2, 150), brand, font=font(44), fill=MOON)
        f, lines = fit_title(title, text_w, (96, 84, 72, 62), 6)
        meta_size, gap = 36, 30

    # the dialog-box card with its coral tab, like on the site
    d.rounded_rectangle([box[0] + 4, box[1] + 10, box[2] + 4, box[3] + 10], radius=26, fill=(8, 10, 30))
    d.rounded_rectangle(box, radius=26, fill=CARD, outline=LINE, width=5)
    tf = font(meta_size)
    tab_w = tf.getlength(tag) + 48
    tab = (box[0] + 30, box[1] - 26, box[0] + 30 + tab_w, box[1] + 26)
    d.rounded_rectangle(tab, radius=18, fill=CORAL, outline=LINE, width=5)
    d.text(((tab[0] + tab[2]) / 2, (tab[1] + tab[3]) / 2), tag, font=tf, fill=(255, 255, 255), anchor="mm")

    line_h = round(f.size * 1.16)
    block_h = line_h * len(lines) + gap + meta_size
    y = box[1] + (box[3] - box[1] - block_h) / 2 + 8
    for line in lines:
        d.text((box[0] + pad, y), line, font=f, fill=INK)
        y += line_h
    d.text((box[0] + pad, y + gap), meta, font=font(meta_size, "Regular"), fill=INK_SOFT)

    if kind == "story":
        cta = f"Read it on {site}"
        d.text(((w - font(46).getlength(cta)) / 2, 1640), cta, font=font(46), fill=MOON)
        d.text(((w - font(32, "Regular").getlength("tap the link sticker")) / 2, 1716), "tap the link sticker",
               font=font(32, "Regular"), fill=(185, 180, 207))
    else:
        d.text((w - 60, h - 22), site, font=font(22, "Regular"), fill=(185, 180, 207), anchor="rs")

    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()
