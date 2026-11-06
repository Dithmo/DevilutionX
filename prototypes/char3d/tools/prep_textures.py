"""Turn downloaded ambientCG (CC0) sets into small, tint-able PBR maps for the character baker.

Outputs (512px JPG, tileable) into proto3d/tex/:
  <name>_detail.jpg  grayscale albedo detail, mean ~0.8 (multiplied by the look's colour)
  <name>_rough.jpg   roughness, contrast-stretched into a target range
  <name>_normal.jpg  OpenGL tangent-space normal
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
N = 512
rng = np.random.default_rng(7)


def load(path, mode='L'):
    im = Image.open(path).convert(mode).resize((N, N), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def save_gray(a, name):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L').convert('RGB').save(OUT / name, quality=88)


def save_rgb(a, name):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'RGB').save(OUT / name, quality=90)


def stretch(a, lo, hi, p=(2, 98)):
    a0, a1 = np.percentile(a, p)
    return lo + (hi - lo) * np.clip((a - a0) / max(1e-4, a1 - a0), 0, 1)


def blur_wrap(a, r):
    """Gaussian blur that keeps the texture tileable."""
    t = np.tile(a, (3, 3))
    im = Image.fromarray((t * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))
    b = np.asarray(im, dtype=np.float32) / 255.0
    return b[N:2 * N, N:2 * N]


def low_noise(scale_px, seed):
    r = np.random.default_rng(seed).random((N, N)).astype(np.float32)
    b = blur_wrap(r, scale_px)
    return (b - b.mean()) / (b.std() + 1e-6)


def detail(color_path, mean=0.8, contrast=1.0):
    L = load(color_path)
    L = (L - L.mean()) / (L.std() + 1e-6)
    return np.clip(mean + 0.11 * contrast * L, 0.35, 1.0)


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-gx * strength, gy * strength, np.ones_like(h)], -1)  # OpenGL: +Y up
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def load_normal(path):
    a = load(path, 'RGB') * 2 - 1
    return a / np.linalg.norm(a, axis=-1, keepdims=True)


def combine_normals(a, b):
    """Whiteout blend."""
    n = np.stack([a[..., 0] + b[..., 0], a[..., 1] + b[..., 1], a[..., 2] * b[..., 2]], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def to_rgb(n):
    return n * 0.5 + 0.5


def hammered():
    """Soft overlapping dents (tileable) like hand-beaten plate."""
    h = np.zeros((N, N), np.float32)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    for _ in range(140):
        cx, cy = rng.random() * N, rng.random() * N
        r = 14 + rng.random() * 34
        dx = (xx - cx + N / 2) % N - N / 2
        dy = (yy - cy + N / 2) % N - N / 2
        h -= np.exp(-(dx * dx + dy * dy) / (r * r)) * (0.6 + rng.random() * 0.4)
    return (h - h.min()) / (h.max() - h.min())


# ---------- metal (shared by plate / steel / gold; tinted per material)
m1 = SRC / 'Metal038'
m2 = SRC / 'Metal054A'
det = 0.7 * detail(m1 / 'Metal038_1K-JPG_Color.jpg') + 0.3 * detail(m2 / 'Metal054A_1K-JPG_Color.jpg')
blot = low_noise(28, 1)
det = np.clip(det + 0.05 * blot, 0.4, 1.0)
save_gray(det, 'metal_detail.jpg')

r1 = load(m1 / 'Metal038_1K-JPG_Roughness.jpg')
r2 = load(m2 / 'Metal054A_1K-JPG_Roughness.jpg')
rough = 0.5 * stretch(r1, 0, 1) + 0.5 * stretch(r2, 0, 1)
rough = stretch(rough, 0.32, 0.66) + 0.07 * low_noise(22, 2) - 0.04 * (det - det.mean()) / det.std()
save_gray(np.clip(rough, 0.22, 0.85), 'metal_rough.jpg')

n_scan = load_normal(m2 / 'Metal054A_1K-JPG_NormalGL.jpg')
n_dent = normal_from_height(hammered(), 9.0)
save_rgb(to_rgb(combine_normals(n_scan, n_dent)), 'metal_normal.jpg')

# ---------- leather
l = SRC / 'Leather037'
save_gray(detail(l / 'Leather037_1K-JPG_Color.jpg', 0.8, 1.2), 'leather_detail.jpg')
save_gray(stretch(load(l / 'Leather037_1K-JPG_Roughness.jpg'), 0.5, 0.82) + 0.05 * low_noise(30, 3), 'leather_rough.jpg')
save_rgb(to_rgb(load_normal(l / 'Leather037_1K-JPG_NormalGL.jpg')), 'leather_normal.jpg')

# ---------- wool
f = SRC / 'Fabric031'
save_gray(detail(f / 'Fabric031_1K-JPG_Color.jpg', 0.82, 1.3), 'fabric_detail.jpg')
save_gray(stretch(load(f / 'Fabric031_1K-JPG_Roughness.jpg'), 0.78, 0.98), 'fabric_rough.jpg')
save_rgb(to_rgb(load_normal(f / 'Fabric031_1K-JPG_NormalGL.jpg')), 'fabric_normal.jpg')

print('ok', sorted(p.name for p in OUT.iterdir()))
