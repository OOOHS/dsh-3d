"""Generate tileable, production-friendly ceramic textures for the mug.

Run with the analysis Python environment:
    python tools/make_textures.py

Outputs live in ../textures relative to this file.
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
TEX = ROOT / "textures"
TEX.mkdir(exist_ok=True)
S = 1024
rng = np.random.default_rng(1977)


def field(seed, sigma):
    r = np.random.default_rng(seed).normal(size=(S, S))
    n = gaussian_filter(r, sigma=sigma, mode="wrap")
    n -= n.min()
    n /= max(n.max(), 1e-12)
    return n.astype(np.float32)


def fbm(seed, sigmas, weights):
    out = np.zeros((S, S), np.float32)
    total = 0.0
    for i, (sig, w) in enumerate(zip(sigmas, weights)):
        out += w * field(seed + i * 37, sig)
        total += w
    out /= total
    out -= out.min()
    out /= out.max()
    return out


def spots(seed, count, radius, strength):
    """Sparse soft dots, wrapped at the edges, in 0..1."""
    r = np.random.default_rng(seed)
    out = np.zeros((S, S), np.float32)
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    kernel = np.exp(-(xx * xx + yy * yy) / (2.0 * max(radius / 1.6, 0.7) ** 2))
    for _ in range(count):
        x = r.integers(0, S)
        y = r.integers(0, S)
        for dy, ky in enumerate(range(-radius, radius + 1)):
            for dx, kx in enumerate(range(-radius, radius + 1)):
                out[(y + dy) % S, (x + dx) % S] += strength * kernel[dy, dx]
    return np.clip(out, 0, 1)


def save_rgb(name, arr):
    arr = np.clip(arr, 0, 1)
    Image.fromarray((arr * 255.0 + 0.5).astype(np.uint8), "RGB").save(TEX / name, optimize=True)


def srgb(hex_value):
    h = hex_value.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


# ---------------------------------------------------------------------------
# Teal glaze. Large soft colour drifts keep the surface from reading as plastic;
# tiny light/dark flecks suggest a reactive handmade glaze.
# ---------------------------------------------------------------------------
teal = srgb("#266560")
mottle = fbm(10, [180, 82, 34, 13], [0.36, 0.30, 0.22, 0.12])
mottle = (mottle - 0.5) * 2.0
fine = fbm(80, [5.0, 2.2], [0.60, 0.40])
light_dots = spots(91, 115, 2, 0.42)
dark_dots = spots(92, 175, 1, 0.50)
ringings = 0.009 * np.sin(np.linspace(0, np.pi * 2 * 46, S, endpoint=False))[None, :]

base = teal[None, None, :] * (1.0 + 0.115 * mottle[..., None] + 0.012 * ringings[..., None])
base += np.array([0.020, 0.047, 0.043], np.float32)[None, None, :] * (mottle[..., None] * 0.55 + 0.18)
base += np.array([0.06, 0.105, 0.095], np.float32)[None, None, :] * light_dots[..., None]
base -= np.array([0.095, 0.055, 0.048], np.float32)[None, None, :] * dark_dots[..., None]
# A faint blue-green pooling variation that follows the texture's low frequencies.
base += np.array([0.005, 0.018, 0.026], np.float32)[None, None, :] * (fine[..., None] - 0.5)
save_rgb("glaze_teal_basecolor.png", base)

# ---------------------------------------------------------------------------
# Warm ivory liner glaze.
# ---------------------------------------------------------------------------
cream = srgb("#E4D5B9")
mottle_c = fbm(30, [210, 85, 30, 11], [0.40, 0.30, 0.20, 0.10])
mottle_c = (mottle_c - 0.5) * 2.0
fine_c = fbm(44, [8.0, 3.0], [0.55, 0.45])
dark_c = spots(71, 145, 1, 0.28)
light_c = spots(72, 80, 2, 0.12)
base_c = cream[None, None, :] * (1.0 + 0.040 * mottle_c[..., None])
base_c += np.array([0.016, 0.021, 0.017], np.float32)[None, None, :] * (fine_c[..., None] - 0.5)
base_c -= np.array([0.055, 0.050, 0.043], np.float32)[None, None, :] * dark_c[..., None]
base_c += np.array([0.05, 0.055, 0.05], np.float32)[None, None, :] * light_c[..., None]
save_rgb("glaze_cream_basecolor.png", base_c)

# ---------------------------------------------------------------------------
# Exposed warm stoneware at the foot ring.
# ---------------------------------------------------------------------------
clay = srgb("#AF9471")
mottle_k = fbm(54, [160, 60, 22, 8], [0.40, 0.30, 0.20, 0.10])
mottle_k = (mottle_k - 0.5) * 2.0
sand = spots(55, 3200, 1, 0.35)
sand_dark = spots(56, 1200, 1, 0.50)
grit = fbm(57, [3.0, 1.2], [0.55, 0.45])
base_k = clay[None, None, :] * (1.0 + 0.10 * mottle_k[..., None])
base_k += np.array([0.055, 0.044, 0.030], np.float32)[None, None, :] * sand[..., None]
base_k -= np.array([0.12, 0.09, 0.06], np.float32)[None, None, :] * sand_dark[..., None]
base_k += np.array([0.018, 0.016, 0.012], np.float32)[None, None, :] * (grit[..., None] - 0.5)
save_rgb("stoneware_basecolor.png", base_k)

# ---------------------------------------------------------------------------
# Subtle shared glaze orange-peel normal map. Height gradients are wrapped so
# the map remains tileable and can be used on both body and handle.
# ---------------------------------------------------------------------------
peel = fbm(120, [11.0, 5.0, 2.2, 1.1], [0.38, 0.28, 0.20, 0.14])
peel = gaussian_filter(peel, sigma=0.55, mode="wrap")
# Very sparse tiny pinholes add one more physical scale to the glaze.
pins = spots(131, 900, 1, 1.0)
pins = gaussian_filter(pins, sigma=0.8, mode="wrap")
height = 0.78 * peel - 0.30 * pins
strength = 0.9
gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
nx = -gx * strength
ny = -gy * strength
nz = np.ones_like(height)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
normal = normal * 0.5 + 0.5
save_rgb("ceramic_normal.png", normal)

# A slightly toothier normal for the unglazed foot.
height_k = fbm(141, [9.0, 3.6, 1.4], [0.42, 0.34, 0.24]) + 0.15 * sand
height_k = gaussian_filter(height_k, sigma=0.5, mode="wrap")
gx = (np.roll(height_k, -1, axis=1) - np.roll(height_k, 1, axis=1)) * 0.5
gy = (np.roll(height_k, -1, axis=0) - np.roll(height_k, 1, axis=0)) * 0.5
nx = -gx * 1.35
ny = -gy * 1.35
nz = np.ones_like(height_k)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
normal_k = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5
save_rgb("stoneware_normal.png", normal_k)

print("Wrote textures to", TEX)
for p in sorted(TEX.glob("*.png")):
    print(" ", p.name, p.stat().st_size)
