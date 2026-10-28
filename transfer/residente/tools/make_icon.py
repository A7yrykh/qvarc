# Иконка Residente: материковая Испания по Natural Earth (public domain) + круг флага.
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

geo = json.load(open(sys.argv[1]))
esp = next(f for f in geo['features'] if f['properties'].get('ADM0_A3') == 'ESP')
polys = esp['geometry']['coordinates']
mainland = max(polys, key=lambda p: len(p[0]))[0]   # самый большой контур — полуостров

S = 1024; K = 4; N = S * K
k = math.cos(math.radians(40))
pts = [(lon * k, -lat) for lon, lat in mainland]
xs, ys = zip(*pts)
minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
box = 0.74 * N
sc = box / max(maxx - minx, maxy - miny)
ox = (N - (maxx - minx) * sc) / 2 - 0.045 * N
oy = (N - (maxy - miny) * sc) / 2 - 0.035 * N
poly = [((x - minx) * sc + ox, (y - miny) * sc + oy) for x, y in pts]

mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(mask).polygon(poly, fill=255)
# Сглаживаем береговую линию до мягкого «иконочного» силуэта.
mask = mask.filter(ImageFilter.GaussianBlur(N * 0.006)).point(lambda v: 255 if v > 128 else 0)

# Круг флага в правом нижнем углу.
cx, cy, r = 0.665 * N, 0.665 * N, 0.215 * N
gap = 0.028 * N
yy, xx = np.mgrid[0:N, 0:N]
d = np.hypot(xx - cx, yy - cy)
land = np.array(mask) > 0
land &= d > r + gap

top, bottom = np.array([14, 74, 92]), np.array([6, 38, 56])
t = (yy / N)[..., None]
img = top * (1 - t) + bottom * t
img[land] = [255, 246, 228]
disc = d <= r
rel = (yy - (cy - r)) / (2 * r)
red, yellow, cream = [198, 11, 30], [255, 196, 0], [255, 246, 228]
img[disc & ((rel < 0.25) | (rel >= 0.75))] = red
img[disc & (rel >= 0.25) & (rel < 0.75)] = yellow
# Тонкие кремовые линии между полосами, как обводка.
line = 0.012
img[disc & (abs(rel - 0.25) < line)] = cream
img[disc & (abs(rel - 0.75) < line)] = cream
ring = (d > r) & (d <= r + 0.012 * N)
img[ring] = cream

out = Image.fromarray(img.clip(0, 255).astype('uint8'), 'RGB').resize((S, S), Image.LANCZOS)
out.save(sys.argv[2])
