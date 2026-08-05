"""Genera iconos para Meet Ninja (PNG, ICO) a partir de un SVG base."""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
os.makedirs(BUILD, exist_ok=True)


def make_icon(size: int = 256) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.22)  # esquinas redondeadas
    # fondo violeta
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(124, 58, 237, 255))
    # proporciones del microfono (basadas en 256)
    cx = size // 2
    # capsula
    cap_w = int(size * 0.16)
    cap_h = int(size * 0.31)
    cap_top = int(size * 0.20)
    d.rounded_rectangle(
        [cx - cap_w, cap_top, cx + cap_w, cap_top + cap_h],
        radius=cap_w,
        outline="white",
        width=max(2, int(size * 0.04)),
    )
    # arco base
    arc_w = int(size * 0.45)
    arc_top = int(size * 0.40)
    d.arc(
        [cx - arc_w // 2, arc_top, cx + arc_w // 2, arc_top + arc_w // 2],
        start=0,
        end=180,
        fill="white",
        width=max(2, int(size * 0.04)),
    )
    # palo
    pole_top = int(size * 0.71)
    d.line(
        [(cx, pole_top), (cx, int(size * 0.86))],
        fill="white",
        width=max(2, int(size * 0.04)),
    )
    # base
    d.line(
        [(int(size * 0.36), int(size * 0.86)), (int(size * 0.64), int(size * 0.86))],
        fill="white",
        width=max(2, int(size * 0.04)),
    )
    # puntos decorativos
    dot_r = max(1, int(size * 0.02))
    for x, y in [
        (int(size * 0.18), int(size * 0.26)),
        (int(size * 0.82), int(size * 0.26)),
        (int(size * 0.18), int(size * 0.74)),
        (int(size * 0.82), int(size * 0.74)),
    ]:
        d.ellipse([x - dot_r * 2, y - dot_r * 2, x + dot_r * 2, y + dot_r * 2], fill=(255, 255, 255, 200))
    return img


def main():
    png = os.path.join(BUILD, "icon.png")
    ico = os.path.join(BUILD, "icon.ico")
    main_img = make_icon(512)
    main_img.save(png, "PNG")
    # ICO multi-size
    main_img.save(
        ico,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"OK: {png}, {ico}")


if __name__ == "__main__":
    main()
