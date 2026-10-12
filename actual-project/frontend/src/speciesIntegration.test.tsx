import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { glyphForSpeciesCategory, mediaForScientificName } from './speciesMedia';
import { SpeciesModelCards, speciesModelError } from './components/SpeciesModelCards';
import type { SpeciesDistributionResult, SpeciesPrediction } from './types';

function prediction(scientificName: string, locationMatchScore = 0.9): SpeciesPrediction {
  return {
    scientificName, speciesSlug: scientificName.replace(/ /g, '-'), commonNameEn: `Name for ${scientificName}`,
    relativeOccurrenceScore: 0.05, locationMatchScore, selectedModel: 'rf',
    defaultRecommendation: true, validationStatus: 'retained', kingdom: 'Animalia',
    category: 'reef_fish', introEn: 'General species information.', recordYears: { min: 1996, max: 2003 },
  };
}

function result(rows: SpeciesPrediction[]): SpeciesDistributionResult {
  return {
    insideMalaysianEez: true, calibratedProbability: false, crossSpeciesRankingValidated: false,
    scoreType: 'relative_occurrence', rankingMethod: 'heuristic_within_species_percentile',
    predictions: rows, topPredictions: rows, modelVersion: 'obis-40', modelCount: rows.length,
    coordinateContext: {
      requestedLatitude: 2.789, requestedLongitude: 101.415, usedLatitude: 2.75, usedLongitude: 101.35,
      method: 'nearest_marine_grid', moved: true, distanceKm: 8.42, maxDistanceKm: 15,
      requestedInsideMalaysianEez: false, interpretation: 'Known beach nearby marine context',
    },
  };
}

const actions = { onRetry: () => {}, scene: '#ddd' };

describe('species model cards', () => {
  it('uses backend recommendation order, shows at most five, and retains all rows in more species', () => {
    const rows = [prediction('Zanclus cornutus', 0.99), { ...prediction('Chelonia mydas', 0.98), relativeOccurrenceScore: 0.95 }, ...Array.from({ length: 38 }, (_, i) => prediction(`New species ${i}`, 0.8 - i * 0.01))];
    const html = renderToStaticMarkup(<SpeciesModelCards result={result(rows)} loading={false} error={null} {...actions} />);
    expect(html.match(/data-species-card=/g)).toHaveLength(5);
    expect(html.indexOf('data-species-card="Zanclus cornutus"')).toBeLessThan(html.indexOf('data-species-card="Chelonia mydas"'));
    expect(html).toContain('More species (40)');
    expect(html).toContain('New species 37');
    expect(html).toContain('Location match 99/100');
    expect(html).toContain('Raw relative score: 0.05');
    expect(html).not.toContain('99%');
    expect(html).toContain('not an occurrence probability');
    expect(html).toContain('not confirmed sightings');
    expect(html).toContain('Historical source records: 1996–2003');
    expect(html).toContain('Requested beach reference: 2.7890, 101.4150');
    expect(html).toContain('Marine-grid reference: 2.7500, 101.3500');
    expect(html).toContain('8.4 km from the beach');
    expect(html).toContain('15 km search limit');
  });

  it('shows the selected new species introduction and its own sources without borrowing a photograph', () => {
    const crab = { ...prediction('Stenopus hispidus'), commonNameEn: 'Banded coral shrimp', category: 'reef_shrimp',
      introEn: 'A striped shrimp found around reef crevices.', sources: [{ title: 'WoRMS: Stenopus hispidus', url: 'https://www.marinespecies.org/aphia.php?p=taxdetails&id=107699' }] };
    const html = renderToStaticMarkup(<SpeciesModelCards result={result([crab])} loading={false} error={null} {...actions} />);
    expect(html).toContain('Banded coral shrimp');
    expect(html).toContain('A striped shrimp found around reef crevices.');
    expect(html).toContain('WoRMS: Stenopus hispidus');
    expect(html).toContain('https://www.marinespecies.org/aphia.php?p=taxdetails&amp;id=107699');
    expect(html).not.toContain('<img');
  });

  it('matches photographs by exact scientific name and uses a neutral fallback for new categories', () => {
    expect(mediaForScientificName('Chelonia mydas')?.imageUrl).toBe('/species/green-sea-turtle.jpg');
    const newSpecies = { ...prediction('Laticauda colubrina'), category: 'sea_krait' };
    const html = renderToStaticMarkup(<SpeciesModelCards result={result([newSpecies])} loading={false} error={null} {...actions} />);
    expect(html).toContain('Laticauda colubrina');
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('green-sea-turtle.jpg');
  });

  it('renders verified pictures in both recommendation cards and More species for model-only taxa', () => {
    const ray = { ...prediction('Taeniura lymma'), commonNameEn: 'Bluespotted fantail ray' };
    const html = renderToStaticMarkup(<SpeciesModelCards result={result([ray])} loading={false} error={null} {...actions} />);
    expect(html).toContain('Taeniura_lymma.JPG');
    expect(html).toContain('Wikimedia Commons');
    expect(html).toContain('Photo credits');
    expect(html.match(/<img/g)?.length).toBe(2);
  });

  it('does not classify cuttlefish as fish merely because their category contains the same letters', () => {
    expect(glyphForSpeciesCategory('reef_fish')).toBe('fish');
    expect(glyphForSpeciesCategory('coastal_reef_fish')).toBe('fish');
    expect(glyphForSpeciesCategory('reef_cuttlefish')).toBeNull();
    const cuttlefish = { ...prediction('Sepia latimanus'), category: 'reef_cuttlefish' };
    const html = renderToStaticMarkup(<SpeciesModelCards result={result([cuttlefish])} loading={false} error={null} {...actions} />);
    expect(html).toContain('Sepia latimanus');
    expect(html).not.toContain('<ellipse');
    expect(html).not.toContain('<img');
  });

  it('does not show stale recommendations or an empty result while loading or failed', () => {
    const stale = result([prediction('Chelonia mydas')]);
    const loading = renderToStaticMarkup(<SpeciesModelCards result={stale} loading error={null} {...actions} />);
    expect(loading).toContain('Loading nearby marine species');
    expect(loading).not.toContain('data-species-card');
    expect(loading).not.toContain('No species recommendations');
    const failed = renderToStaticMarkup(<SpeciesModelCards result={stale} loading={false} error={speciesModelError(new Error('Network unavailable'))} {...actions} />);
    expect(failed).toContain('Retry');
    expect(failed).not.toContain('data-species-card');
    expect(failed).not.toContain('No species recommendations');
  });

  it('separates a 422 unsupported area from a successful response without candidates', () => {
    const outside = renderToStaticMarkup(<SpeciesModelCards result={null} loading={false} error={speciesModelError(new ApiError('Outside', 422, 'OUTSIDE_MODEL_AREA'))} {...actions} />);
    expect(outside).toContain('Nearby marine area unavailable');
    expect(outside).toContain('within 15 km');
    expect(outside).not.toContain('No species recommendations');
    const empty = renderToStaticMarkup(<SpeciesModelCards result={result([])} loading={false} error={null} {...actions} />);
    expect(empty).toContain('No species recommendations');
    expect(empty).toContain('not evidence that marine life is absent');
    expect(empty).not.toContain('Retry');
  });

  it('keeps zero-score and non-recommended species out of the main cards', () => {
    const rows = [{ ...prediction('Zero species'), relativeOccurrenceScore: 0 }, { ...prediction('Reference species'), defaultRecommendation: false }];
    const html = renderToStaticMarkup(<SpeciesModelCards result={result(rows)} loading={false} error={null} {...actions} />);
    expect(html).not.toContain('data-species-card');
    expect(html).toContain('More species (2)');
    expect(html).toContain('Reference context only');
  });
});
