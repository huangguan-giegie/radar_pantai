import { describe, expect, it } from "vitest";
import { placeMapLabels, placeMapPhotos, type MapLabelPoint, type MapLabelRect } from "./mapLabels";

const point = (id: string, x: number, y: number, preferred = true, name = `Pantai ${id}`): MapLabelPoint =>
  ({ id, x, y, preferred, name });
const overlaps = (a: MapLabelRect, b: MapLabelRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function expectWithinViewport(labels: MapLabelRect[], width: number, height: number) {
  for (const label of labels) {
    expect(label.x).toBeGreaterThanOrEqual(8);
    expect(label.y).toBeGreaterThanOrEqual(8);
    expect(label.x + label.width).toBeLessThanOrEqual(width - 8);
    expect(label.y + label.height).toBeLessThanOrEqual(height - 8);
  }
  labels.forEach((label, index) => {
    for (const other of labels.slice(index + 1)) expect(overlaps(label, other)).toBe(false);
  });
}

function expectNearAnchors(labels: (MapLabelRect & { id: string })[], points: MapLabelPoint[], maximum = 40) {
  for (const label of labels) {
    const anchor = points.find(item => item.id === label.id)!;
    expect(anchor).toBeDefined();
    const dx = Math.max(label.x - anchor.x, 0, anchor.x - label.x - label.width);
    const dy = Math.max(label.y - anchor.y, 0, anchor.y - label.y - label.height);
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(maximum);
  }
}

function offsetsFor(labels: (MapLabelRect & { id: string })[], points: MapLabelPoint[]) {
  return new Map(labels.map(label => {
    const anchor = points.find(item => item.id === label.id)!;
    return [label.id, { x: label.x - anchor.x, y: label.y - anchor.y, width: label.width, height: label.height }];
  }));
}

describe("marine photo tap targets", () => {
  it("keeps coastal photos clear of nearby controls and report counts on a small phone", () => {
    const obstacles = [
      { x: 14, y: 12, width: 205, height: 32 },
      { x: 132, y: 206, width: 176, height: 44 },
      { x: 14, y: 206, width: 80, height: 44 },
      { x: 145, y: 116, width: 30, height: 30 },
    ];
    const photos = placeMapPhotos([point('turtle', 172, 214), point('coral', 160, 130)],
      { width: 320, height: 262, obstacles });
    expect(photos.map(photo => photo.id)).toEqual(['turtle', 'coral']);
    expectWithinViewport(photos, 320, 262);
    for (const photo of photos) {
      expect(photo.width).toBeGreaterThanOrEqual(44);
      for (const obstacle of obstacles) expect(overlaps(photo, obstacle)).toBe(false);
    }
    const labels = placeMapLabels([point('beach', 172, 214)],
      { width: 320, height: 262, obstacles: [...obstacles, ...photos], compact: true });
    expectNearAnchors(labels, [point('beach', 172, 214)]);
    for (const label of labels) for (const photo of photos) expect(overlaps(label, photo)).toBe(false);
  });

  it("keeps edge photos visible without bringing offscreen or invalid records into the view", () => {
    const photos = placeMapPhotos([point('edge', 318, 1), point('outside', -30, 120), point('invalid', NaN, 50)],
      { width: 320, height: 262 });
    expect(photos.map(photo => photo.id)).toEqual(['edge']);
    expectWithinViewport(photos, 320, 262);
    expect(placeMapPhotos([point('blocked', 50, 50)], { width: 100, height: 100,
      obstacles: [{ x: 0, y: 0, width: 100, height: 100 }] })).toEqual([]);
  });
});

describe("map label placement", () => {
  it("keeps all names when their nearby positions fit", () => {
    const points = [point('a', 100, 140), point('b', 300, 140), point('c', 100, 340), point('d', 300, 340)];
    const labels = placeMapLabels(points, { width: 402, height: 420 });
    expect(labels.map(label => label.id)).toEqual(['a', 'b', 'c', 'd']);
    expectWithinViewport(labels, 402, 420);
    expectNearAnchors(labels, points);
  });

  it("prioritizes nearby names without repacking a crowded coast into distant rows", () => {
    const important = Array.from({ length: 7 }, (_, index) => point(`main-${index}`, 196 + index, 130 + index));
    const nearby = Array.from({ length: 20 }, (_, index) => point(`optional-${index}`, 190 + index, 135, false));
    const points = [...nearby, ...important];
    const before = points.map(item => ({ ...item }));
    const labels = placeMapLabels(points, { width: 402, height: 320 });
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThan(points.length);
    expect(labels.some(label => important.some(item => item.id === label.id))).toBe(true);
    expectWithinViewport(labels, 402, 320);
    expectNearAnchors(labels, points);
    // The layout returns only labels; it must leave every beach available to
    // the caller for its geographic dot, search results and Beach List.
    expect(points).toEqual(before);
  });

  it("does not use distant free space when all positions near a beach are blocked", () => {
    const points = [point('blocked', 180, 150)];
    const obstacle = { x: 110, y: 80, width: 140, height: 140 };
    expect(placeMapLabels(points, { width: 402, height: 360, obstacles: [obstacle] })).toEqual([]);
    expect(points).toHaveLength(1);
  });

  it("keeps North names near their beaches and clear of controls on a 320px phone", () => {
    const important = [
      point("kuala-perlis", 161, 116, true, "Pantai Kuala Perlis"),
      point("cenang", 116, 126, true, "Pantai Cenang"),
      point("merdeka", 186, 195, true, "Pantai Merdeka"),
      point("batu-ferringhi", 173, 216, true, "Pantai Batu Ferringhi"),
      point("bersih", 187, 218, true, "Pantai Bersih"),
    ];
    const optional = Array.from({ length: 12 }, (_, index) => point(`optional-${index}`, 140 + index, 150 + index, false));
    const obstacles = [
      { x: 14, y: 12, width: 200.82, height: 30.86 },
      { x: 234.1, y: 163.41, width: 73.89, height: 122.14 },
      { x: 14, y: 249.41, width: 78.16, height: 36.14 },
    ];
    for (const height of [307, 307.55]) {
      const labels = placeMapLabels([...optional, ...important], { width: 320, height, obstacles });
      expect(labels.length).toBeGreaterThan(0);
      expectWithinViewport(labels, 320, height);
      expectNearAnchors(labels, [...important, ...optional]);
      for (const label of labels) for (const obstacle of obstacles) expect(overlaps(label, obstacle)).toBe(false);
      expect(placeMapLabels([...important, ...optional].reverse(), { width: 320, height, obstacles })).toEqual(labels);
    }
  });

  it("keeps long names readable at narrow widths without forcing every name into columns", () => {
    const points = Array.from({ length: 6 }, (_, index) =>
      point(`long-${index}`, 160, 110 + index, true, `Pantai a longer beach name ${index}`));
    const labels = placeMapLabels(points, { width: 320, height: 170 });
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every(label => label.width <= 149)).toBe(true);
    expectWithinViewport(labels, 320, 170);
    expectNearAnchors(labels, points);
  });

  it("uses compact nearby labels below the NSM hint without overlapping controls", () => {
    const points = [
      point("pantai-tanjung-gemuk", 130, 100, true, "Pantai Tanjung Gemuk"),
      point("pantai-cahaya-negeri", 145, 117, true, "Pantai Cahaya Negeri"),
      point("teluk-kemang", 154, 132, true, "Teluk Kemang"),
      point("pantai-pengkalan-balak", 170, 173, true, "Pantai Pengkalan Balak"),
      point("pantai-kundor", 191, 202, true, "Pantai Kundor"),
      point("pantai-siring", 213, 216, true, "Pantai Siring"),
      point("pulau-besar-melaka", 223, 236, true, "Pulau Besar, Melaka"),
      point("optional", 180, 187, false, "Pantai optional"),
    ];
    const obstacles = [
      { x: 14, y: 12, width: 219, height: 30.86 },
      { x: 234.1, y: 163.41, width: 73.89, height: 122.14 },
      { x: 14, y: 249.41, width: 78.16, height: 36.14 },
    ];
    const labels = placeMapLabels(points, { width: 320, height: 308, obstacles, compact: true });
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every(label => label.height === 34)).toBe(true);
    expectWithinViewport(labels, 320, 308);
    expectNearAnchors(labels, points);
    for (const label of labels) for (const obstacle of obstacles) expect(overlaps(label, obstacle)).toBe(false);
    expect(placeMapLabels([...points].reverse(), { width: 320, height: 308, obstacles, compact: true })).toEqual(labels);
  });

  it("does not clamp offscreen beaches onto the map after panning or zooming", () => {
    const points = [
      point("left", -9, 80), point("right", 409, 80),
      point("top", 80, -9), point("bottom", 80, 309),
      point("inside", 200, 150), point("near-edge", -7, 220),
    ];
    const labels = placeMapLabels(points, { width: 400, height: 300 });
    expect(labels.some(label => label.id === 'inside')).toBe(true);
    expect(labels.every(label => ['inside', 'near-edge'].includes(label.id))).toBe(true);
    expectWithinViewport(labels, 400, 300);
    expectNearAnchors(labels, points);
  });

  it("reserves 90px only for a photo label while ordinary beach labels use 48px", () => {
    const points = [
      { ...point('photo', 100, 160), labelHeight: 90 },
      { ...point('plain', 300, 160), labelHeight: 48 },
      { ...point('other', 100, 340), labelHeight: 48 },
    ];
    const labels = placeMapLabels(points, { width: 402, height: 420, labelHeight: 90 });
    expect(labels).toHaveLength(3);
    expect(labels.find(label => label.id === 'photo')?.height).toBe(90);
    expect(labels.filter(label => label.id !== 'photo').every(label => label.height === 48)).toBe(true);
    expectWithinViewport(labels, 402, 420);
    expectNearAnchors(labels, points);
  });

  it('gives a marine preview a nearby slot before ordinary preferred names', () => {
    const points = [
      { ...point('plain', 160, 100, true, 'A'), labelHeight: 48 },
      { ...point('photo', 160, 160, true, 'B'), labelHeight: 90 },
    ];
    const labels = placeMapLabels(points, { width: 320, height: 260 });
    expect(labels).toHaveLength(2);
    expect(labels[0].id).toBe('photo');
    expectWithinViewport(labels, 320, 260);
    expectNearAnchors(labels, points);
  });

  it('does not cover another beach dot when placing a nearby name', () => {
    const points = [point('main', 100, 140, true, 'A'), point('nearby', 100, 100, false, 'B')];
    const labels = placeMapLabels(points, { width: 320, height: 300 });
    expect(labels.some(label => label.id === 'main')).toBe(true);
    for (const label of labels) for (const anchor of points) {
      const dx = Math.max(label.x - anchor.x, 0, anchor.x - label.x - label.width);
      const dy = Math.max(label.y - anchor.y, 0, anchor.y - label.y - label.height);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(6);
    }
    expectNearAnchors(labels, points);
  });

  it("is deterministic across input order and orders preferred labels by y then id", () => {
    const points = [point("z", 300, 360, false), point("b", 300, 230), point("a", 100, 230), point("c", 100, 100), point("y", 100, 360, false)];
    const first = placeMapLabels(points, { width: 402, height: 440 });
    expect(placeMapLabels([...points].reverse(), { width: 402, height: 440 })).toEqual(first);
    expect(first.map(label => label.id)).toEqual(["c", "a", "b", "y", "z"]);
  });

  it("retains preferred names when only one label fits and skips unplaceable labels", () => {
    const labels = placeMapLabels([point("optional", 75, 70, false), point("main", 75, 70)], { width: 150, height: 80 });
    expect(labels.map(label => label.id)).toEqual(["main"]);
    expect(placeMapLabels([point("main", 60, 20)], { width: 120, height: 50 })).toEqual([]);
    expect(placeMapLabels([point("main", 60, 30)], { width: 120, height: 60, obstacles: [{ x: 0, y: 0, width: 120, height: 60 }] })).toEqual([]);
  });

  it("limits label dimensions and ignores invalid anchors without mutating inputs", () => {
    const points = [point("short", 100, 100, true, "A"), point("long", 300, 230, true, "Pantai a very long beach name that cannot fit at full width"), point("bad", NaN, 100)];
    const before = points.map(row => ({ ...row }));
    const labels = placeMapLabels(points, { width: 402, height: 260 });
    expect(labels.map(label => label.width)).toEqual([100, 156]);
    expect(labels.every(label => label.height === 42)).toBe(true);
    expectWithinViewport(labels, 402, 260);
    expect(points).toEqual(before);
    expect(placeMapLabels(points, { width: NaN, height: 260 })).toEqual([]);
  });
});

describe('stable map label offsets', () => {
  it('translates existing names with their beaches instead of choosing new positions after a pan', () => {
    const points = [point('a', 100, 150), point('b', 300, 150)];
    const first = placeMapLabels(points, { width: 402, height: 360 });
    expect(first).toHaveLength(2);
    const previousOffsets = offsetsFor(first, points);
    const before = Array.from(previousOffsets, ([id, offset]) => [id, { ...offset }]);
    const moved = points.map(item => ({ ...item, x: item.x + 14, y: item.y + 20 }));
    const next = placeMapLabels(moved, { width: 402, height: 360, previousOffsets });
    expect(next).toEqual(first.map(label => ({ ...label, x: label.x + 14, y: label.y + 20 })));
    expect(Array.from(previousOffsets)).toEqual(before);
    expectWithinViewport(next, 402, 360);
  });

  it('hides a cached label at the viewport edge and restores the same offset when its beach returns', () => {
    const points = [point('a', 200, 150)];
    const first = placeMapLabels(points, { width: 402, height: 320 });
    expect(first).toHaveLength(1);
    const previousOffsets = offsetsFor(first, points);
    // The point is still inside the map, but its original label extends left of it.
    const atEdge = [{ ...points[0], x: 20 }];
    expect(placeMapLabels(atEdge, { width: 402, height: 320, previousOffsets })).toEqual([]);
    expect(placeMapLabels(points, { width: 402, height: 320, previousOffsets })).toEqual(first);
  });

  it('hides a cached label behind a control without jumping it into another free slot', () => {
    const points = [point('a', 200, 150)];
    const first = placeMapLabels(points, { width: 402, height: 320 });
    const previousOffsets = offsetsFor(first, points);
    expect(first).toHaveLength(1);
    const obstacle = { x: first[0].x, y: first[0].y, width: 12, height: 12 };
    expect(placeMapLabels(points, { width: 402, height: 320, previousOffsets, obstacles: [obstacle] })).toEqual([]);
    expect(placeMapLabels(points, { width: 402, height: 320, previousOffsets })).toEqual(first);
  });

  it.each([
    { reason: 'a control', old: point('old', 130, 90, false, 'A'), newcomer: point('new', 180, 90, true, 'B'),
      offset: { x: -50, y: -70, width: 100, height: 48 }, obstacles: [{ x: 80, y: 20, width: 10, height: 10 }] },
    { reason: 'the viewport edge', old: point('old', 40, 210, false, 'A'), newcomer: point('new', 90, 210, true, 'B'),
      offset: { x: -50, y: -60, width: 100, height: 48 }, obstacles: [] },
  ])('reserves an existing label hidden by $reason so a new name cannot steal its slot', ({ old, newcomer, offset, obstacles }) => {
    const reserved = { ...offset, x: old.x + offset.x, y: old.y + offset.y };
    const options = { width: 402, height: 320, labelHeight: 48, obstacles };
    const withoutReservation = placeMapLabels([newcomer], options);
    expect(withoutReservation).toHaveLength(1);
    expect(overlaps(withoutReservation[0], reserved)).toBe(true);
    const previousOffsets = new Map([[old.id, offset]]);
    const labels = placeMapLabels([old, newcomer], { ...options, previousOffsets });
    expect(labels.some(label => label.id === old.id)).toBe(false);
    expect(labels.some(label => label.id === newcomer.id)).toBe(true);
    expect(labels.every(label => !overlaps(label, reserved))).toBe(true);
    expect(previousOffsets.get(old.id)).toEqual(offset);
  });
});

describe('marine preview label fallback', () => {
  it('keeps nearby beach names when full photo cards cannot fit', () => {
    const points = [
      { ...point('north', 70, 80, true, 'A'), labelHeight: 90, fallbackHeight: 48 },
      { ...point('south', 70, 180, true, 'B'), labelHeight: 90, fallbackHeight: 48 },
    ];
    const options = { width: 140, height: 260 };
    expect(placeMapLabels(points.map(item => ({ ...item, fallbackHeight: undefined })), options)).toEqual([]);
    const labels = placeMapLabels(points, options);
    expect(labels.map(label => label.id)).toEqual(['north', 'south']);
    expect(labels.every(label => label.height === 48)).toBe(true);
    expectWithinViewport(labels, options.width, options.height);
    expectNearAnchors(labels, points);
  });

  it('keeps a cached name-only label at 48px when panning opens room for its 90px photo', () => {
    const beach = { ...point('photo', 70, 100, true, 'A'), labelHeight: 90, fallbackHeight: 48 };
    const options = { width: 140, height: 320, obstacles: [{ x: 8, y: 140, width: 124, height: 100 }] };
    const first = placeMapLabels([beach], options);
    expect(first).toHaveLength(1);
    expect(first[0].height).toBe(48);
    const previousOffsets = offsetsFor(first, [beach]);
    const moved = { ...beach, y: beach.y + 40 };
    // Without an assignment, this new position can fit the full photo card.
    expect(placeMapLabels([moved], options)[0].height).toBe(90);
    const next = placeMapLabels([moved], { ...options, previousOffsets });
    expect(next).toEqual([{ ...first[0], y: first[0].y + 40 }]);
    expect(previousOffsets.get(beach.id)?.height).toBe(48);
    expect(placeMapLabels([beach], { ...options, previousOffsets })).toEqual(first);
  });

  it('does not downgrade and reposition an existing photo card when its cached position leaves the viewport', () => {
    const beach = { ...point('photo', 70, 140, true, 'A'), labelHeight: 90, fallbackHeight: 48 };
    const options = { width: 140, height: 320, obstacles: [{ x: 8, y: 140, width: 124, height: 100 }] };
    const first = placeMapLabels([beach], options);
    expect(first).toHaveLength(1);
    expect(first[0].height).toBe(90);
    const previousOffsets = offsetsFor(first, [beach]);
    const moved = { ...beach, y: beach.y - 40 };
    expect(placeMapLabels([moved], options)[0].height).toBe(48);
    expect(placeMapLabels([moved], { ...options, previousOffsets })).toEqual([]);
    expect(previousOffsets.get(beach.id)?.height).toBe(90);
    expect(placeMapLabels([beach], { ...options, previousOffsets })).toEqual(first);
  });
});
