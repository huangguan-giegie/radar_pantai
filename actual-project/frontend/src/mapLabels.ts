export type MapLabelPoint = {
  id: string;
  x: number;
  y: number;
  preferred: boolean;
  name: string;
  labelHeight?: number;
  fallbackHeight?: number;
};

export type MapLabelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlacedMapLabel = MapLabelRect & { id: string };
export type MapLabelOffset = MapLabelRect;

export type MapLabelLayoutOptions = {
  width: number;
  height: number;
  obstacles?: readonly MapLabelRect[];
  compact?: boolean;
  labelHeight?: number;
  maxLeaderLength?: number;
  previousOffsets?: ReadonlyMap<string, MapLabelOffset>;
};

const MARGIN = 8;
const GAP = 6;
const ANCHOR_GAP = 10;
const GRID_STEP = 12;
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const labelWidth = (name: string, maximum = 156) => Math.min(maximum, Math.max(100, Math.ceil(name.length * 6.2 + 22)));

/** Keep photo tap targets clear of map controls and each other at phone sizes. */
export function placeMapPhotos(
  points: readonly { id: string; x: number; y: number }[],
  { width, height, obstacles = [] }: MapLabelLayoutOptions,
): PlacedMapLabel[] {
  const size = 44;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < size + MARGIN * 2 || height < size + MARGIN * 2) return [];
  const placed: PlacedMapLabel[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
    const rect = (x: number, y: number) => ({
      id: point.id, x: Math.max(MARGIN, Math.min(width - size - MARGIN, x)),
      y: Math.max(MARGIN, Math.min(height - size - MARGIN, y)), width: size, height: size,
    });
    const fits = (candidate: PlacedMapLabel) => ![...obstacles, ...placed].some(other => overlaps(candidate, other));
    const nearby = [rect(point.x - 22, point.y + 6), rect(point.x - 22, point.y - 50),
      rect(point.x + 6, point.y - 22), rect(point.x - 50, point.y - 22)].find(fits);
    if (nearby) { placed.push(nearby); continue; }
    const candidates: PlacedMapLabel[] = [];
    for (let x = MARGIN; x + size <= width - MARGIN; x += GRID_STEP) {
      for (let y = MARGIN; y + size <= height - MARGIN; y += GRID_STEP) {
        const candidate = rect(x, y);
        if (fits(candidate)) candidates.push(candidate);
      }
    }
    candidates.sort((a, b) => (a.x + 22 - point.x) ** 2 + (a.y + 22 - point.y) ** 2
      - (b.x + 22 - point.x) ** 2 - (b.y + 22 - point.y) ** 2);
    if (candidates[0]) placed.push(candidates[0]);
  }
  return placed;
}

function overlaps(a: MapLabelRect, b: MapLabelRect): boolean {
  return a.x < b.x + b.width + GAP && a.x + a.width + GAP > b.x &&
    a.y < b.y + b.height + GAP && a.y + a.height + GAP > b.y;
}

function leaderDistance(point: MapLabelPoint, rect: MapLabelRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width);
  const dy = Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height);
  return dx * dx + dy * dy;
}

/** Keep names near their coast dots and preserve their geographic offset while panning. */
export function placeMapLabels(
  points: readonly MapLabelPoint[],
  { width, height, obstacles = [], compact = false, labelHeight = compact ? 34 : 42,
    maxLeaderLength = 40, previousOffsets = new Map() }: MapLabelLayoutOptions,
): PlacedMapLabel[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 + MARGIN * 2 || height < MARGIN * 2) return [];
  const maximumWidth = Math.max(100, Math.min(156, Math.floor((width - MARGIN * 2 - ANCHOR_GAP * 2) / 2)));
  const blocked = obstacles.filter(rect =>
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0,
  );
  const unique = [...new Map(points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map(point => [point.id, point])).values()]
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) ||
      (b.labelHeight ?? labelHeight) - (a.labelHeight ?? labelHeight) ||
      (a.preferred ? a.y - b.y : 0) || compareId(a.id, b.id));
  const visibleAnchor = (point: MapLabelPoint) => point.x >= -MARGIN && point.x <= width + MARGIN
    && point.y >= -MARGIN && point.y <= height + MARGIN;
  const inViewport = (rect: MapLabelRect) => rect.x >= MARGIN && rect.y >= MARGIN
    && rect.x + rect.width <= width - MARGIN && rect.y + rect.height <= height - MARGIN;
  const clearOfControls = (rect: MapLabelRect) => !blocked.some(other => overlaps(rect, other));
  const clearOfDots = (rect: MapLabelRect) => !unique.some(point => leaderDistance(point, rect) < 6 ** 2);
  const distanceAllowed = (point: MapLabelPoint, rect: MapLabelRect) => {
    const distance = leaderDistance(point, rect);
    return distance >= ANCHOR_GAP ** 2 - .01 && distance <= maxLeaderLength ** 2;
  };
  const placed: PlacedMapLabel[] = [];
  const occupied: MapLabelRect[] = [];
  const assigned = new Set<string>();

  // Keep assignments even when their labels temporarily leave the viewport or
  // pass under a fixed control. They must return to the same side of the beach.
  for (const point of unique) {
    const offset = previousOffsets.get(point.id);
    const w = labelWidth(point.name, maximumWidth);
    if (!offset || offset.width !== w || ![point.labelHeight ?? labelHeight, point.fallbackHeight].includes(offset.height)) continue;
    const h = offset.height;
    const rect = { x: point.x + offset.x, y: point.y + offset.y, width: w, height: h };
    if (!distanceAllowed(point, rect)) continue;
    occupied.push(rect);
    assigned.add(point.id);
    if (visibleAnchor(point) && inViewport(rect) && clearOfControls(rect)) placed.push({ id: point.id, ...rect });
  }

  for (const point of unique) {
    if (assigned.has(point.id) || !visibleAnchor(point)) continue;
    const w = labelWidth(point.name, maximumWidth);
    let rect: MapLabelRect | undefined;
    for (const h of [point.labelHeight ?? labelHeight, point.fallbackHeight]) {
      if (h === undefined || !Number.isFinite(h) || h <= 0 || h > height - MARGIN * 2) continue;
      const candidates: MapLabelRect[] = [];
      // Search only around the anchor, never pack names into unrelated screen rows.
      for (const gap of [ANCHOR_GAP, 22, 34]) {
        for (const alignment of [.5, .25, .75, 0, 1]) {
          candidates.push(
            { x: point.x - w * alignment, y: point.y - h - gap, width: w, height: h },
            { x: point.x - w * alignment, y: point.y + gap, width: w, height: h },
            { x: point.x - w - gap, y: point.y - h * alignment, width: w, height: h },
            { x: point.x + gap, y: point.y - h * alignment, width: w, height: h },
          );
        }
        for (const x of [point.x - w - gap, point.x + gap]) {
          candidates.push({ x, y: point.y - h - gap, width: w, height: h },
            { x, y: point.y + gap, width: w, height: h });
        }
      }
      rect = candidates.filter(candidate => distanceAllowed(point, candidate)
        && inViewport(candidate) && clearOfControls(candidate) && clearOfDots(candidate)
        && !occupied.some(other => overlaps(candidate, other)))
        .sort((a, b) => leaderDistance(point, a) - leaderDistance(point, b))[0];
      if (rect) break;
    }
    // Dense areas keep their clickable coast dots; zooming or Beach List exposes
    // every beach without drawing a long leader across the rest of the coast.
    if (rect) {
      placed.push({ id: point.id, ...rect });
      occupied.push(rect);
    }
  }
  return placed;
}
