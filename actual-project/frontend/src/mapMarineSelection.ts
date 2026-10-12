import content from './content/coastalContent.json';
import { marineRecordDetails } from './biodiversity';
import { beachMarineCards, beachMarineReferences, type BeachMarineCard, type BeachWildlifeSpecies } from './beachMarineLife';

export type MapMarineItem = BeachMarineCard & { kind?: 'habitat' };

export function mapMarineCards(beachId: string, wildlife: readonly BeachWildlifeSpecies[] = []): MapMarineItem[] {
  const cards: MapMarineItem[] = beachMarineCards(beachId, wildlife);
  const habitatIds = new Set(beachMarineReferences(beachId).map(record => record.habitatId));
  for (const habitat of content.habitats.filter(item => habitatIds.has(item.id))) {
    cards.push({ id: `habitat-${habitat.id}`, kind: 'habitat', name: habitat.title, image: null,
      creditsUrl: '/credits', destination: `/habitats/${habitat.id}?beach=${encodeURIComponent(beachId)}`,
      published: true, modelled: false });
  }
  return cards;
}

export function marineLayerEnabled(params: URLSearchParams) {
  return params.get('marine') === 'on' || (params.get('marine') !== 'off' && params.get('layer') === 'bio');
}

export function marineLayerParams(previous: URLSearchParams, enabled: boolean) {
  const next = new URLSearchParams(previous);
  next.set('marine', enabled ? 'on' : 'off');
  next.delete('layer');
  next.delete('beach');
  return next;
}

export function selectMapBeach(previous: URLSearchParams, beach: { id: string; region: string }) {
  const next = new URLSearchParams(previous);
  next.set('marine', 'on');
  next.set('region', beach.region);
  if (next.get('beach') === beach.id) next.delete('beach');
  else next.set('beach', beach.id);
  ['layer', 'panel', 'q', 'record'].forEach(key => next.delete(key));
  return next;
}

export function radialSpecies<T extends BeachMarineCard>(cards: readonly T[]) {
  const firstCount = cards.length > 6 ? 5 : 6;
  return { visible: cards.slice(0, firstCount), remaining: cards.slice(firstCount) };
}

export function radialPoints(count: number) {
  const angles = count === 2 ? [-150, -30] : Array.from({ length: count }, (_, i) => -90 + i * 360 / count);
  return angles.map((angle, index) => ({
    x: 140 + 112 * Math.cos(angle * Math.PI / 180),
    y: 140 + 112 * Math.sin(angle * Math.PI / 180),
    // A caption below the north photo would intrude into a long beach title.
    captionAbove: count !== 2 && index === 0,
  }));
}

/** Fit the complete selection, including controls and captions outside the SVG.
 * The returned centre is also the Leaflet pan target, so the circle stays on
 * the selected beach coordinate instead of being moved independently of it.
 */
export const MIN_MARINE_SELECTION_HEIGHT = 460;

export function marineSelectionLayout(view: { x: number; y: number }, cardCount: number) {
  const canvasHeight = Math.max(view.y, MIN_MARINE_SELECTION_HEIGHT);
  const points = radialPoints(Math.min(cardCount, 6));
  const inset = 8;
  const boundsFor = (diameter: number) => ({
    left: Math.min(-4, ...points.map(point => point.x * diameter / 280 - 47)),
    right: Math.max(diameter + 4, ...points.map(point => point.x * diameter / 280 + 47)),
    top: Math.min(-4, diameter / 2 - 43,
      ...points.map(point => point.y * diameter / 280 - 27 - (point.captionAbove ? 5 + 34 : 0))),
    // The status starts 42px below the ring; reserve 80px for a request error
    // and evidence text. Two-line names need 34px below their 54px circles.
    bottom: Math.max(diameter + 122,
      ...points.map(point => point.y * diameter / 280 + 27 + (point.captionAbove ? 0 : 5 + 34))),
  });
  let low = 0;
  let high = cardCount > 2 ? 284 : 248;
  for (let iteration = 0; iteration < 24; iteration++) {
    const candidate = (low + high) / 2;
    const bounds = boundsFor(candidate);
    if (bounds.right - bounds.left <= view.x - inset * 2
      && bounds.bottom - bounds.top <= canvasHeight - inset * 2) low = candidate;
    else high = candidate;
  }
  const diameter = low;
  const bounds = boundsFor(diameter);
  return {
    x: (view.x - bounds.right - bounds.left) / 2 + diameter / 2,
    y: (canvasHeight - bounds.bottom - bounds.top) / 2 + diameter / 2,
    diameter,
    canvasHeight,
  };
}

export function regionMarineReferenceCount(regionId: string) {
  const records = content.regions.find(region => region.id === regionId)?.records ?? [];
  return new Set(records.map(record => marineRecordDetails(record).speciesId ?? record.name)).size;
}
