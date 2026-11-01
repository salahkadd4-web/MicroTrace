"""Particles from a label image: contour, Feret diameters, shape descriptors.

Coordinates are in pixel-edge space: pixel ``(row, col)`` covers ``[col, col + 1) x [row, row + 1)``
and a contour vertex is ``(x, y)``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import ndimage as ndi
from skimage import measure

MAX_CONTOUR_POINTS = 200


@dataclass(frozen=True)
class Particle:
    id: int
    contour: tuple[tuple[float, float], ...]
    bbox: tuple[int, int, int, int]  # x_min, y_min, x_max, y_max (max exclusive, pixels)
    area_px: float
    feret_max_px: float
    feret_min_px: float
    eq_diameter_px: float
    circularity: float
    solidity: float
    elongation: float
    aspect: float
    extent: float
    eccentricity: float
    touches_border: bool


def _hull(points: np.ndarray) -> np.ndarray:
    """Convex hull (counter-clockwise, no repeated point) by Andrew's monotone chain."""
    pts = np.unique(np.asarray(points, dtype=np.float64), axis=0)
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[np.ndarray] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[np.ndarray] = []
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def feret(points: np.ndarray) -> tuple[float, float]:
    """(maximum, minimum) Feret diameter by rotating calipers on the convex hull.

    The maximum is the largest vertex distance; the minimum is the smallest width over the
    hull's edge directions (the minimum width is always attained along an edge).
    """
    hull = _hull(points)
    if len(hull) < 2:
        return 0.0, 0.0
    diff = hull[:, None, :] - hull[None, :, :]
    fmax = float(np.sqrt((diff ** 2).sum(-1)).max())
    if len(hull) < 3:
        return fmax, 0.0
    edges = np.roll(hull, -1, axis=0) - hull
    length = np.hypot(edges[:, 0], edges[:, 1])
    normals = np.stack([-edges[:, 1], edges[:, 0]], axis=1) / length[:, None]
    proj = hull @ normals.T  # (vertices, edges)
    fmin = float((proj.max(axis=0) - proj.min(axis=0)).min())
    return fmax, fmin


def _boundary_corners(mask: np.ndarray) -> np.ndarray:
    """Pixel-corner points (x, y) of the boundary pixels of ``mask``."""
    inner = ndi.binary_erosion(np.pad(mask, 1), structure=ndi.generate_binary_structure(2, 1))
    edge = np.pad(mask, 1) & ~inner
    rows, cols = np.nonzero(edge[1:-1, 1:-1])
    xs = np.concatenate([cols, cols + 1, cols, cols + 1])
    ys = np.concatenate([rows, rows, rows + 1, rows + 1])
    return np.stack([xs, ys], axis=1).astype(np.float64)


def _contour(mask: np.ndarray) -> tuple[np.ndarray, float]:
    """(simplified closed contour in x, y edge coordinates, perimeter of the full outline)."""
    padded = np.pad(mask.astype(np.float64), 1)
    found = measure.find_contours(padded, 0.5)
    if not found:
        return np.zeros((0, 2)), 0.0
    longest = max(found, key=len)
    xy = np.stack([longest[:, 1] - 1 + 0.5, longest[:, 0] - 1 + 0.5], axis=1)
    if not np.array_equal(xy[0], xy[-1]):
        xy = np.vstack([xy, xy[:1]])
    perimeter = float(np.hypot(*np.diff(xy, axis=0).T).sum())
    tol = 1.0
    simple = measure.approximate_polygon(xy, tol)
    while len(simple) > MAX_CONTOUR_POINTS:
        tol *= 1.4
        simple = measure.approximate_polygon(xy, tol)
    if not np.array_equal(simple[0], simple[-1]):
        simple = np.vstack([simple, simple[:1]])
    return simple, perimeter


def particles_from_labels(labels: np.ndarray, limit: int | None = None) -> list[Particle]:
    """One ``Particle`` per label, ids 1..n by decreasing area (ties: smaller label first).

    ``limit`` keeps only the largest ones, without measuring the others.
    """
    labels = np.asarray(labels)
    h, w = labels.shape
    counts = np.bincount(labels.ravel().astype(np.int64))
    ids = np.nonzero(counts[1:] > 0)[0] + 1 if len(counts) > 1 else np.array([], dtype=int)
    if len(ids) == 0:
        return []
    order = ids[np.lexsort((ids, -counts[ids]))]
    if limit is not None:
        order = order[:limit]
    objects = ndi.find_objects(labels.astype(np.int32))
    out: list[Particle] = []
    for new_id, lab in enumerate(order, start=1):
        sl = objects[lab - 1]
        mask = labels[sl] == lab
        rmin, cmin = sl[0].start, sl[1].start
        area = float(counts[lab])
        contour, perimeter = _contour(mask)
        contour_xy = contour + np.array([cmin, rmin], dtype=np.float64)
        hull_pts = _boundary_corners(mask)
        fmax, fmin = feret(hull_pts)
        hull_area = _polygon_area(_hull(hull_pts))
        props = measure.regionprops(mask.astype(np.uint8))[0]
        major, minor = float(props.axis_major_length), float(props.axis_minor_length)
        width = 2.0 * float(ndi.distance_transform_edt(np.pad(mask, 1)).max())
        width = max(width, 1.0)
        elongation = max(fmax, area / width) / width
        bh, bw = mask.shape
        circularity = min(1.0, 4.0 * math.pi * area / (perimeter ** 2)) if perimeter > 0 else 0.0
        out.append(Particle(
            id=new_id,
            contour=tuple((float(x), float(y)) for x, y in contour_xy),
            bbox=(int(cmin), int(rmin), int(cmin + bw), int(rmin + bh)),
            area_px=area, feret_max_px=float(fmax), feret_min_px=float(fmin),
            eq_diameter_px=math.sqrt(4.0 * area / math.pi),
            circularity=float(circularity),
            solidity=float(min(1.0, area / hull_area)) if hull_area > 0 else 1.0,
            elongation=float(max(elongation, 1.0)),
            aspect=float(max(major / max(minor, 1e-6), 1.0)),
            extent=float(area / (bh * bw)),
            eccentricity=float(props.eccentricity),
            touches_border=bool(rmin == 0 or cmin == 0 or rmin + bh == h or cmin + bw == w)))
    return out


def _polygon_area(poly: np.ndarray) -> float:
    if len(poly) < 3:
        return 0.0
    x, y = poly[:, 0], poly[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)
