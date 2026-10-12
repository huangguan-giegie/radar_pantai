import { ApiError } from '../api';
import { Info, SpeciesIcon } from './Icon';
import { ErrorNote, Skeleton } from './ui';
import { C, MONO } from '../theme';
import { glyphForSpeciesCategory, mediaForScientificName } from '../speciesMedia';
import { speciesPhotoReference } from '../visuals';
import type { SpeciesDistributionResult, SpeciesPrediction } from '../types';

export function decimalScoreLabel(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function locationMatchLabel(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}/100`;
}

export interface SpeciesModelError {
  kind: 'outside' | 'invalid' | 'unavailable';
  message: string;
}

export function speciesModelError(reason: unknown): SpeciesModelError {
  if (reason instanceof ApiError && reason.status === 422) {
    return { kind: 'outside', message: 'There is no supported nearby marine point within 15 km of this beach.' };
  }
  if (reason instanceof ApiError && reason.status === 400) {
    return { kind: 'invalid', message: 'The beach location could not be used to load species information.' };
  }
  return { kind: 'unavailable', message: reason instanceof Error ? reason.message : 'Please check your connection and try again.' };
}

function recordYearsLabel(prediction: SpeciesPrediction): string {
  const { min, max } = prediction.recordYears ?? {};
  if (min == null && max == null) return 'Record years unavailable';
  return `Historical source records: ${min != null && max != null && min !== max ? `${min}–${max}` : max ?? min}`;
}

/** Separate states and cards are independently renderable for contract tests. */
export function SpeciesModelCards({
  result, loading, error, onRetry, scene, preview = false,
}: {
  result: SpeciesDistributionResult | null;
  loading: boolean;
  error: SpeciesModelError | null;
  onRetry: () => void;
  scene: string;
  preview?: boolean;
}) {
  if (preview) {
    return <div style={{ fontSize: 12.5, color: C.muted }}>The historical species model is unavailable in this local preview.</div>;
  }
  if (loading) {
    return <div role="status" aria-live="polite"><div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>Loading nearby marine species…</div><Skeleton h={180} r={22} /></div>;
  }
  if (error) {
    return <ErrorNote title={error.kind === 'outside' ? 'Nearby marine area unavailable' : 'Could not load nearby species'} body={error.message} onRetry={error.kind === 'outside' ? undefined : onRetry} />;
  }
  if (!result) return null;
  const cards = result.topPredictions.filter((row) => row.defaultRecommendation && row.relativeOccurrenceScore > 0).slice(0, 5);
  const coordinates = result.coordinateContext;
  return (
    <>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.muted, marginBottom: 12 }}>
        Historical nearby marine context · not confirmed sightings. Location match compares this point with other reference locations for each species; it is not an occurrence probability.
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.dim, marginBottom: 12 }}>
        Requested beach reference: {coordinates.requestedLatitude.toFixed(4)}, {coordinates.requestedLongitude.toFixed(4)}
        {' · '}Marine-grid reference: {coordinates.usedLatitude.toFixed(4)}, {coordinates.usedLongitude.toFixed(4)}
        {' · '}{coordinates.moved ? `${coordinates.distanceKm.toFixed(1)} km from the beach` : 'Same location'}{' · '}15 km search limit
      </div>
      {cards.length === 0 ? (
        <div style={{ border: `1.5px dashed ${C.line2}`, borderRadius: 22, padding: 20, fontSize: 13, lineHeight: 1.5, color: C.muted }}>
          No species recommendations are available for this marine location. This is not evidence that marine life is absent.
        </div>
      ) : (
        <div className="scroll-x" style={{ display: 'flex', gap: 12, paddingBottom: 6, margin: '0 -16px', paddingInline: 16, scrollSnapType: 'x proximity' }}>
          {cards.map((prediction) => {
            const media = mediaForScientificName(prediction.scientificName);
            const photoReference = speciesPhotoReference(prediction.commonNameEn || prediction.scientificName);
            const picture = media?.imageUrl ?? photoReference?.image ?? null;
            const creditsUrl = media?.imageSourceUrl ?? photoReference?.creditsUrl ?? null;
            const glyph = glyphForSpeciesCategory(prediction.category ?? '');
            return (
              <article key={prediction.scientificName} data-species-card={prediction.scientificName} style={{ width: 226, flex: 'none', background: C.white, border: `1px solid ${C.line}`, borderRadius: 22, overflow: 'hidden', scrollSnapAlign: 'start', boxShadow: '0 10px 26px -24px rgba(11,33,97,.7)' }}>
                <div style={{ height: 132, position: 'relative', overflow: 'hidden', background: picture ? scene : C.tint }}>
                  {picture ? (
                    <img src={picture} alt={media?.imageAlt ?? (prediction.commonNameEn || prediction.scientificName) + ' · species reference photograph'} loading="lazy" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', objectPosition: media?.imageObjectPosition ?? 'center' }} />
                  ) : (
                    <div aria-hidden="true" style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      {glyph ? <SpeciesIcon glyph={glyph} size={48} /> : <Info size={48} color={C.slate} />}
                    </div>
                  )}
                  <div style={{ position: 'absolute', right: 10, bottom: 10, padding: '5px 9px', borderRadius: 999, background: 'rgba(7,22,50,.82)', color: C.bg, fontFamily: MONO, fontSize: 9.5, fontWeight: 700 }}>
                    Location match {locationMatchLabel(prediction.locationMatchScore)}
                  </div>
                </div>
                <div style={{ padding: '14px 14px 15px' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 680, lineHeight: 1.25, color: C.ink2 }}>{prediction.commonNameEn || prediction.scientificName}</div>
                  <div style={{ fontSize: 11.5, fontStyle: 'italic', lineHeight: 1.35, color: C.dim, marginTop: 3 }}>{prediction.scientificName}</div>
                  {prediction.introEn && <p style={{ fontSize: 12, lineHeight: 1.5, color: C.muted, margin: '10px 0' }}>{prediction.introEn}</p>}
                  {prediction.sources?.length ? <div style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 10 }}>Sources: {prediction.sources.map((source, index) => <span key={source.url}>{index > 0 && ' · '}<a href={source.url} target="_blank" rel="noreferrer" style={{ color: C.slate, textDecoration: 'underline' }}>{source.title}</a></span>)}</div> : null}
                  <details style={{ fontSize: 11.5, lineHeight: 1.5, color: C.muted, marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', color: C.slate }}>Model details</summary>
                    <div style={{ marginTop: 7 }}>Raw relative score: {decimalScoreLabel(prediction.relativeOccurrenceScore)} (0–1)</div>
                    <div>{recordYearsLabel(prediction)}</div>
                    <div>Historical source records describe the model inputs, not a current beach observation.</div>
                    {creditsUrl && <div style={{ marginTop: 7 }}>Photo reference: <a href={creditsUrl} target={creditsUrl.startsWith('https://') ? '_blank' : undefined} rel="noreferrer" style={{ color: C.slate, textDecoration: 'underline' }}>{media ? media.imageAuthor + ' · ' + media.imageLicense : 'Wikimedia Commons · photographer and licence'}</a></div>}
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <details style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5, color: C.muted }}>
        <summary style={{ cursor: 'pointer', fontWeight: 650, color: C.slate }}>More species ({result.predictions.length})</summary>
        <p>All species in this model package, including those without a recommendation. These are model results for the marine location above, not locally observed species.</p>
        {result.predictions.map((prediction) => (
          <div key={prediction.scientificName} style={{ padding: '10px 0', borderTop: `1px solid ${C.line}` }}>
            {(() => {
              const media = mediaForScientificName(prediction.scientificName);
              const photo = speciesPhotoReference(prediction.commonNameEn || prediction.scientificName);
              const url = media?.imageUrl ?? photo?.image;
              const creditsUrl = media?.imageSourceUrl ?? photo?.creditsUrl;
              return url ? <div style={{ marginBottom: 5 }}>
                <img src={url} alt={prediction.commonNameEn || prediction.scientificName}
                  loading="lazy" style={{ width: 72, height: 52, objectFit: 'cover', borderRadius: 9, display: 'block' }} />
                {creditsUrl && <a href={creditsUrl} target={creditsUrl.startsWith('https://') ? '_blank' : undefined}
                  rel="noreferrer" style={{ fontSize: 10, color: C.slate, textDecoration: 'underline' }}>Photo credits ↗</a>}
              </div> : null;
            })()}
            <div style={{ fontWeight: 650, color: C.ink2 }}>{prediction.commonNameEn || prediction.scientificName}</div>
            <div style={{ fontStyle: 'italic' }}>{prediction.scientificName}</div>
            <div>Location match {locationMatchLabel(prediction.locationMatchScore)} · Raw relative score {decimalScoreLabel(prediction.relativeOccurrenceScore)}</div>
            <div>{recordYearsLabel(prediction)}</div>
            {prediction.introEn && <p>{prediction.introEn}</p>}
            {prediction.sources?.length ? <div>Sources: {prediction.sources.map((source, index) => <span key={source.url}>{index > 0 && ' · '}<a href={source.url} target="_blank" rel="noreferrer" style={{ color: C.slate, textDecoration: 'underline' }}>{source.title}</a></span>)}</div> : null}
            {!prediction.defaultRecommendation && <div>Reference context only · no recommendation</div>}
          </div>
        ))}
        <p>A high location match can accompany a low raw score. Card order is an exploratory comparison across species and has not been independently validated. Neither score is a probability.</p>
        <div style={{ fontSize: 10.5 }}>OBIS historical snapshot · model {result.modelVersion}</div>
      </details>
    </>
  );
}
