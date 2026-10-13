import { describe, expect, it } from 'vitest';
import marineDirectorySource from './screens/MarineLifeScreen.tsx?raw';
import { marineLayerEnabled, marineLayerParams, radialPoints, radialSpecies, selectMapBeach, mapMarineCards, marineSelectionLayout } from './mapMarineSelection';
import type { BeachMarineCard } from './beachMarineLife';

describe('shared map marine-life workflow', () => {
  it('opens the map from the Marine Life directory with its overlay enabled', () => {
    expect(marineDirectorySource).toContain('nav("/map?marine=on")');
    expect(marineLayerEnabled(new URLSearchParams('marine=on'))).toBe(true);
  });
  it('links existing habitats only where a beach has a matching published record', () => {
    const morib = mapMarineCards('morib');
    expect(morib.find(card => card.kind === 'habitat')?.destination).toBe('/habitats/morib-mudflat?beach=morib');
    expect(morib.filter(card => card.kind !== 'habitat')).toHaveLength(2);
    expect(mapMarineCards('remis').some(card => card.kind === 'habitat')).toBe(false);
    expect(mapMarineCards('pantai-air-batang-tioman')).toEqual([]);
  });
  it('starts with Marine Life enabled, while explicit off is respected', () => {
    expect(marineLayerEnabled(new URLSearchParams())).toBe(true);
    expect(marineLayerEnabled(new URLSearchParams('region=selangor'))).toBe(true);
    expect(marineLayerEnabled(new URLSearchParams('marine=on'))).toBe(true);
    expect(marineLayerEnabled(new URLSearchParams('layer=bio&beach=morib'))).toBe(true);
    expect(marineLayerEnabled(new URLSearchParams('layer=bio&marine=off'))).toBe(false);
    expect(marineLayerEnabled(new URLSearchParams('layer=litter'))).toBe(false);
  });

  it('switches layers without losing the region or carrying an old expanded beach', () => {
    const previous = new URLSearchParams('region=selangor&layer=bio&beach=morib');
    const off = marineLayerParams(previous, false);
    expect(off.get('region')).toBe('selangor');
    expect(marineLayerEnabled(off)).toBe(false);
    expect(off.has('beach')).toBe(false);
    expect(off.has('layer')).toBe(false);
    expect(marineLayerEnabled(marineLayerParams(off, true))).toBe(true);
    expect(previous.get('beach')).toBe('morib');
  });

  it('expands one beach, switches to a different beach, and collapses a repeated selection', () => {
    const morib = { id: 'morib', region: 'selangor' };
    const bagan = { id: 'bagan', region: 'selangor' };
    const selected = selectMapBeach(new URLSearchParams('q=morib&panel=beaches&region=johor'), morib);
    expect(selected.get('beach')).toBe('morib');
    expect(selected.get('region')).toBe('selangor');
    expect(selected.has('q')).toBe(false);
    expect(selected.has('panel')).toBe(false);
    expect(selectMapBeach(selected, bagan).getAll('beach')).toEqual(['bagan']);
    expect(selectMapBeach(selected, morib).has('beach')).toBe(false);
  });

  it('keeps all 40 results reachable without crowding the ring', () => {
    const cards = Array.from({ length: 40 }, (_, i) => ({ id: `species-${i}` } as BeachMarineCard));
    const { visible, remaining } = radialSpecies(cards);
    expect(visible).toHaveLength(5);
    expect(remaining).toHaveLength(35);
    expect([...visible, ...remaining]).toEqual(cards);
    expect(radialSpecies(cards.slice(0, 6)).remaining).toEqual([]);
    expect(radialSpecies([]).visible).toEqual([]);
  });

  it('keeps the six touch targets separated even on a small phone', () => {
    const points = radialPoints(6);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) * 220 / 280).toBeGreaterThan(54);
      }
    }
    expect(radialPoints(0)).toEqual([]);
  });

  it('expands a short canvas so six photos remain usable and all captions fit', () => {
    const canvas = { x: 320, y: 300 };
    const layout = marineSelectionLayout(canvas, 6);
    expect(layout.canvasHeight).toBeGreaterThan(canvas.y);
    expect(layout.diameter).toBeGreaterThanOrEqual(264);
    const left = layout.x - layout.diameter / 2;
    const top = layout.y - layout.diameter / 2;
    expect(top - 4).toBeGreaterThanOrEqual(8);
    expect(top + layout.diameter + 42 + 80).toBeLessThanOrEqual(layout.canvasHeight - 8);
    for (const point of radialPoints(6)) {
      const x = left + point.x * layout.diameter / 280;
      const y = top + point.y * layout.diameter / 280;
      expect(x - 47).toBeGreaterThanOrEqual(8);
      expect(x + 47).toBeLessThanOrEqual(canvas.x - 8);
      const captionTop = point.captionAbove ? y - 27 - 5 - 34 : y + 27 + 5;
      expect(Math.min(y - 27, captionTop)).toBeGreaterThanOrEqual(8);
      expect(Math.max(y + 27, captionTop + 34)).toBeLessThanOrEqual(layout.canvasHeight - 8);
      expect(captionTop + 34).toBeLessThan(top + layout.diameter + 42);
    }
    const points = radialPoints(6);
    expect(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      * layout.diameter / 280).toBeGreaterThan(54);
  });

  it('puts the north caption outside a long beach title without clipping the short canvas', () => {
    const carey = mapMarineCards('pantai-tanjung-rhu-pulau-carey');
    expect(carey).toHaveLength(1);
    for (const count of [carey.length, 3, 6]) {
      const layout = marineSelectionLayout({ x: 320, y: 300 }, count);
      const north = radialPoints(count)[0];
      expect(north.captionAbove).toBe(true);
      const photoY = layout.y - layout.diameter / 2 + north.y * layout.diameter / 280;
      const captionBottom = photoY - 27 - 5;
      expect(captionBottom - 34).toBeGreaterThanOrEqual(8);
      // The long Carey beach title makes the centre taller than its 86px minimum.
      // Give it 120px here, slightly more than its measured 113px browser height.
      expect(captionBottom).toBeLessThan(layout.y - 120 / 2);
      expect(layout.diameter).toBeCloseTo(count === 1 ? 248 : 284, 4);
      expect(layout.y + layout.diameter / 2 + 42 + 80).toBeLessThanOrEqual(layout.canvasHeight - 8);
    }
    // The two-node layout is diagonal; its names keep their original positions.
    expect(radialPoints(2).every(point => !point.captionAbove)).toBe(true);
  });

  it('keeps full-size rings when space allows and fits the More entry for a large result set', () => {
    const roomy = marineSelectionLayout({ x: 402, y: 500 }, 40);
    expect(roomy.diameter).toBeCloseTo(284, 4);
    expect(marineSelectionLayout({ x: 320, y: 300 }, 40))
      .toEqual(marineSelectionLayout({ x: 320, y: 300 }, 6));
  });
});
