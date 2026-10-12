import content from './content/coastalContent.json';
import { MARINE_PIN_REFERENCES, marineRecordDetails } from './biodiversity';
import { modelSpeciesDestination } from './modelSpeciesNavigation';
import { speciesPhotoReference } from './visuals';

export type BeachWildlifeSpecies = {
  name: string;
  scientificName?: string | null;
  evidenceType: string;
};

export type BeachMarineCard = {
  id: string;
  name: string;
  scientificName?: string | null;
  image: string | null;
  creditsUrl: string;
  destination: string;
  published: boolean;
  modelled: boolean;
  referencePlace?: string;
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const PILOT_BEACHES = new Set(['morib', 'remis', 'kelanang', 'bagan']);

export function beachMarineReferences(beachId: string) {
  const beach = content.beaches.find(item => item.id === beachId);
  const region = content.regions.find(item => item.id === beach?.region);
  const pinIndices = new Set((MARINE_PIN_REFERENCES[beach?.region ?? ''] ?? [])
    .filter(([, id]) => id === beachId).map(([index]) => index));
  return (region?.records ?? []).filter((record, index) => pinIndices.has(index)
    || (beach && normalize(record.place) === normalize(beach.name))).map(marineRecordDetails);
}

/** Keep map references tied to their named place, then add API evidence once per species. */
export function beachMarineCards(beachId: string, wildlife: readonly BeachWildlifeSpecies[] = []): BeachMarineCard[] {
  const beach = content.beaches.find(item => item.id === beachId);
  const cards = new Map<string, BeachMarineCard>();
  const addReference = (speciesId: string | null, place?: string) => {
    const guide = content.species.find(item => item.id === speciesId);
    if (!guide || cards.has(guide.id)) return;
    cards.set(guide.id, {
      id: guide.id, name: guide.name, image: guide.image,
      scientificName: guide.subtitle.split(' · ').reverse().find(value => value !== 'Mangrove tree' && /^[A-Z][a-z]+ [a-z]+$/.test(value)) ?? null,
      creditsUrl: guide.photoSource || '/credits', destination: `/species/${guide.id}?beach=${encodeURIComponent(beachId)}`,
      published: true, modelled: false, referencePlace: place,
    });
  };

  // The four original beaches have individually curated species. Expanded
  // preview lists contain regional examples, so use their named map records.
  if (beach && PILOT_BEACHES.has(beachId)) beach.species.forEach(id => addReference(id, beach.name));
  beachMarineReferences(beachId).forEach(record => addReference(record.speciesId, record.place));

  for (const item of wildlife) {
    const guide = content.species.find(candidate => normalize(candidate.name) === normalize(item.name) ||
      (item.scientificName && candidate.subtitle.toLowerCase().includes(item.scientificName.toLowerCase())));
    const id = guide?.id ?? normalize(item.scientificName || item.name);
    if (!id) continue;
    const modelled = item.evidenceType === 'modelled';
    const existing = cards.get(id);
    if (existing) {
      existing.modelled ||= modelled;
      existing.published ||= !modelled;
      existing.scientificName ||= item.scientificName;
      continue;
    }
    const photo = speciesPhotoReference(guide?.name ?? item.name);
    cards.set(id, {
      id, name: guide?.name ?? item.name, scientificName: item.scientificName,
      image: photo?.image ?? null, creditsUrl: photo?.creditsUrl ?? '/credits',
      destination: guide ? `/species/${guide.id}?beach=${encodeURIComponent(beachId)}`
        : (modelled ? modelSpeciesDestination(item.scientificName, beachId) : null) ?? '/insights/wildlife',
      published: !modelled, modelled,
    });
  }
  return [...cards.values()];
}
