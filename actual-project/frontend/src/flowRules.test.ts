// Tests for the report-flow rules, and for the small helpers the map, the home
// list and the beach pages lean on.
//
// WHY THESE AND NOT THE SCREENS. Everything under test here is a pure
// function: give it a draft, or a handful of values, and it returns a
// decision, with no React and no browser involved. That makes these cases
// cheap to write and cheap to trust. The same logic buried inside a component
// would need a rendered page and a fake router before one case could be run.
//
// Two blocks below exist because of bugs that actually shipped: the photo
// guard for corrections, and the way back from the review screen.
import { describe, expect, it } from 'vitest';
import type { ReportDraft } from './AppContext';
import { CAME_FROM_DETAILS, backFromReview, buildReportSubmission, findExactDuplicateReport, finishReportSubmission, formatReportComposition, guardStep, hasDraftProgress, historicalPhotoUnavailable, orderByNeed, reachableStep, reportOutcome, safeNextPath } from './flowRules';
import { markerHtml } from './components/BeachMarker';
import type { BeachSummary } from './types';
import { attentionStateFor, formatDate } from './theme';

describe('fixed date presentation', () => {
  // The "now" is pinned, so these cases do not change answer on the day the
  // suite happens to run.
  it('uses the exact date and weekday while preserving an unambiguous order', () => {
    expect(formatDate('2026-09-16T04:00:00+08:00', new Date('2026-09-20T12:00:00+08:00'))).toBe('16-09-2026 (Wed)');
  });

  it('says Today for a timestamp from the current Malaysia day', () => {
    const now = new Date('2026-09-16T23:30:00+08:00');
    expect(formatDate('2026-09-16T00:10:00+08:00', now)).toBe('Today');
    // 23:30 on the 15th in UTC is already the 16th in Malaysia.
    expect(formatDate('2026-09-15T23:30:00Z', now)).toBe('Today');
    expect(formatDate('2026-09-15T12:00:00+08:00', now)).toBe('15-09-2026 (Tue)');
  });
});

// A complete, valid draft. Each test passes in only the fields it wants to
// break, so a test reads as "this one thing is wrong" rather than twelve lines
// of setup that hide which field the case is actually about.
function draft(changes: Partial<ReportDraft> = {}): ReportDraft {
  return {
    photo: { photoKey: 'mock/test.jpg', previewUrl: 'blob:test', metadataStripped: true },
    existingPhotoUrl: null,
    existingPhotoKey: null,
    existingPhotoUnavailable: false,
    beachId: 'morib',
    beachName: 'Pantai Morib',
    linkedEventId: null,
    locationSource: 'manual',
    coords: null,
    quantities: { Plastic: 'Small' },
    aiDecision: 'manual',
    aiModelState: 'ready',
    aiModelVersion: null,
    gpsIssue: null,
    editingReportId: null,
    editingStatus: null,
    editingStatusNote: null,
    ...changes,
  };
}

// A beach with one or two reports gets no severity band at all. Three counted
// reports is the minimum the scoring method asks for, and printing "High" off
// a single report would be a claim the data cannot support. These tests hold
// that line, including the sentence that tells the reader why there is no band
// yet.
describe('attentionStateFor', () => {
  it.each([0, 1, 2])('keeps %s counted reports in a neutral insufficient-data state', (validReports) => {
    const reportWord = validReports === 1 ? 'report' : 'reports';
    expect(attentionStateFor(null, true, validReports)).toEqual({
      markerLabel: 'INSUFFICIENT DATA',
      pageLabel: 'Insufficient data',
      detail: `${validReports} counted ${reportWord} · At least 3 counted reports are required for a band`,
      hasBand: false,
    });
  });

  it('shows the severity label once the beach has enough counted reports', () => {
    expect(attentionStateFor('High', false, 3)).toEqual({
      markerLabel: 'HIGH',
      pageLabel: 'High',
      detail: null,
      hasBand: true,
    });
  });

  it('does not trust a band when the count is below the minimum', () => {
    expect(attentionStateFor('High', false, 1).hasBand).toBe(false);
  });
});

// safeNextPath cleans the "?next=" value we redirect to after login. That
// value comes from the URL, so anyone can put anything in it - these tests are
// the guard against an open redirect off our own site.
describe('safeNextPath', () => {
  it('keeps valid internal paths', () => {
    expect(safeNextPath('/report/photo?from=home')).toBe('/report/photo?from=home');
  });

  it.each([null, '', 'https://example.com', '//example.com', '/\\example.com'])(
    'rejects an unsafe redirect: %s',
    (value) => {
      expect(safeNextPath(value)).toBe('/home');
    },
  );
});

describe('findExactDuplicateReport', () => {
  const existing = {
    id: 'R-2041',
    beachId: 'morib',
    beachName: 'Pantai Morib',
    quantities: { Plastic: 'Small' as const, Glass: 'Medium' as const },
    category: 'Glass' as const,
    quantity: 'Medium' as const,
    categoryScores: {},
    reportScore: 1,
    createdAt: '2026-09-10T03:00:00.000Z',
    status: 'Counted' as const,
  };

  it('finds a same-day exact match regardless of category key order', () => {
    expect(findExactDuplicateReport(
      draft({ quantities: { Glass: 'Medium', Plastic: 'Small' } }),
      [existing],
      new Date('2026-09-10T12:00:00+08:00'),
    )?.id).toBe('R-2041');
  });

  it('does not warn when one confirmed quantity differs', () => {
    expect(findExactDuplicateReport(
      draft({ quantities: { Glass: 'Large', Plastic: 'Small' } }),
      [existing],
      new Date('2026-09-10T12:00:00+08:00'),
    )).toBeNull();
  });
});

describe('buildReportSubmission', () => {
  it('allows manual correction after recognition but requires confirmation before review', () => {
    const recognized = draft({ aiModelState: 'ready', aiDecision: null, quantities: { Plastic: 'Medium' } });
    expect(reachableStep(recognized)).toBe('details');
    expect(guardStep('details', recognized)).toBeNull();
    expect(guardStep('review', recognized)).toBe('/report/details');
  });

  it('requires recognition after replacing an existing report photo', () => {
    expect(reachableStep(draft({ editingReportId: 'saved-report', aiModelState: null, aiDecision: null }))).toBe('suggestions');
  });

  it('refuses unconfirmed AI or manual values', () => {
    expect(() => buildReportSubmission(draft({ aiDecision: null }))).toThrow(/Confirm the AI suggestion/);
  });

  it('includes coordinates only for a GPS report', () => {
    const result = buildReportSubmission(
      draft({ locationSource: 'gps', coords: { lat: 2.95, lng: 101.42 } }),
    );
    expect(result.kind).toBe('create');
    if (result.kind === 'create') {
      expect(result.payload.locationSource).toBe('gps');
      expect(result.payload.coords).toEqual({ lat: 2.95, lng: 101.42 });
    }
  });

  it('removes stale coordinates from a manual report', () => {
    const result = buildReportSubmission(
      draft({ locationSource: 'manual', coords: { lat: 2.95, lng: 101.42 } }),
    );
    expect(result.kind).toBe('create');
    if (result.kind === 'create') {
      expect(result.payload.locationSource).toBe('manual');
      expect(result.payload).not.toHaveProperty('coords');
    }
  });

  it('carries every picked category through to the payload', () => {
    const result = buildReportSubmission(
      draft({ quantities: { Plastic: 'Large', 'Fishing gear': 'Medium', Glass: 'Small' } }),
    );
    expect(result.kind).toBe('create');
    if (result.kind === 'create') {
      expect(result.payload.quantities).toEqual({
        Plastic: 'Large',
        'Fishing gear': 'Medium',
        Glass: 'Small',
      });
    }
  });

  it('refuses a report with no category at all', () => {
    expect(() => buildReportSubmission(draft({ quantities: {} }))).toThrow(/missing a required field/);
  });

  it('refuses a category that was picked but given no quantity band', () => {
    expect(() =>
      buildReportSubmission(draft({ quantities: { Plastic: 'Large', Glass: undefined } })),
    ).toThrow(/Glass/);
  });

  it('keeps every category when only the photo is corrected', () => {


    const result = buildReportSubmission(
      draft({
        editingReportId: 'report-1',
        quantities: { Plastic: 'Large', 'Fishing gear': 'Medium', Glass: 'Small' },
      }),
    );
    expect(result.kind).toBe('update');
    if (result.kind === 'update') {
      expect(result.changes.quantities).toEqual({
        Plastic: 'Large',
        'Fishing gear': 'Medium',
        Glass: 'Small',
      });
    }
  });

  it('allows an existing report to be corrected without a replacement photo', () => {
    const result = buildReportSubmission(
      draft({ editingReportId: 'report-1', photo: null, existingPhotoUrl: '/existing.jpg' }),
    );
    expect(result).toEqual({
      kind: 'update',
      reportId: 'report-1',
      changes: {
        beachId: 'morib',
        quantities: { Plastic: 'Small' },
        locationSource: 'manual',
      },
    });
  });

  it('reuses the existing photo key when its preview is unavailable', () => {
    const result = buildReportSubmission(
      draft({
        editingReportId: 'report-1',
        photo: null,
        existingPhotoUrl: null,
        existingPhotoKey: 'seed/r1.jpg',
        existingPhotoUnavailable: true,
      }),
    );
    expect(result).toEqual({
      kind: 'update',
      reportId: 'report-1',
      changes: {
        beachId: 'morib',
        quantities: { Plastic: 'Small' },
        locationSource: 'manual',
        photoKey: 'seed/r1.jpg',
      },
    });
  });

  // Correcting a report must not quietly change how its location was found.
  // There are no fresh coordinates in the draft, so neither field is sent, and
  // the report keeps the GPS source it was filed with.
  it('preserves the original GPS source when correcting without new coordinates', () => {
    const result = buildReportSubmission(
      draft({
        editingReportId: 'report-gps',
        photo: null,
        existingPhotoUrl: '/existing.jpg',
        locationSource: 'gps',
        coords: null,
      }),
    );
    expect(result.kind).toBe('update');
    if (result.kind === 'update') {
      expect(result.changes).not.toHaveProperty('locationSource');
      expect(result.changes).not.toHaveProperty('coords');
    }
  });
});

// The one-line summary that stands in for the findings table on the saved
// screen and in the report list. The order must not follow whatever order the
// user happened to tick the boxes in.
describe('report composition display', () => {
  it('shows every selected category and quantity in a stable order', () => {
    expect(formatReportComposition({ Glass: 'Small', Plastic: 'Large', 'Fishing gear': 'Medium' }))
      .toBe('Plastic — Large · Fishing gear — Medium · Glass — Small');
  });

  it('returns a neutral value when no category is available', () => {
    expect(formatReportComposition({})).toBe('No categories recorded');
  });
});

// A report can have a photo on file and still have nothing to show for it -
// a key with no URL. The correction draft has to carry that fact, or the
// review page promises a photo the user cannot see.
describe('Historical correction draft photo state', () => {
  it('marks a keyed report without a preview as unavailable on entry', () => {
    expect(historicalPhotoUnavailable(null, 'seed/r1.jpg')).toBe(true);
    expect(historicalPhotoUnavailable('/photo.jpg', 'seed/r1.jpg')).toBe(false);
    expect(historicalPhotoUnavailable(null, null)).toBe(false);
  });
});

describe('reportOutcome', () => {
  it('returns truthful outcomes for every report status', () => {
    expect(reportOutcome('Counted').badge).toContain('COUNTED');
    expect(reportOutcome('Duplicate').badge).toContain('DUPLICATE');
    expect(reportOutcome('Incomplete').badge).toContain('INCOMPLETE');
  });
});

// What happens when somebody types a URL straight into the middle of the
// report flow, or opens an old bookmark. This is a web-only problem: a phone
// app has no address bar.
describe('Flow guards for direct URLs into the reporting flow', () => {
  const blank = draft({ photo: null, beachId: null, beachName: null, quantities: {} });

  it('keeps an empty draft on the first step', () => {
    expect(reachableStep(blank)).toBe('photo');
    expect(guardStep('review', blank)).toBe('/report/photo');
    expect(guardStep('details', blank)).toBe('/report/photo');
    expect(guardStep('photo', blank)).toBeNull();
  });

  it('stops at beach confirmation when a photo has no beach', () => {
    const d = draft({ beachId: null, beachName: null, quantities: {} });
    expect(guardStep('details', d)).toBe('/report/confirm');
    expect(guardStep('confirm', d)).toBeNull();


    expect(guardStep('location', d)).toBeNull();
  });

  it('stops at details when a photo and beach have no category', () => {
    const d = draft({ quantities: {}, aiModelState: 'empty' });
    expect(guardStep('review', d)).toBe('/report/details');
    expect(guardStep('details', d)).toBeNull();
  });

  it('treats a category without a quantity band as incomplete', () => {
    const d = draft({ quantities: { Plastic: undefined }, aiModelState: 'empty' });
    expect(guardStep('review', d)).toBe('/report/details');
  });

  it('allows a complete draft to access every step after refresh', () => {
    const d = draft();
    for (const step of ['photo', 'location', 'confirm', 'details', 'suggestions', 'review'] as const) {
      expect(guardStep(step, d)).toBeNull();
    }
  });

  it('requires an AI or manual decision before Review', () => {
    const d = draft({ aiDecision: null, aiModelState: 'ready' });
    expect(reachableStep(d)).toBe('details');
    expect(guardStep('review', d)).toBe('/report/details');
    expect(guardStep('suggestions', d)).toBeNull();
  });

  it('runs recognition before the manual category and band form', () => {
    const beforeAi = draft({ quantities: {}, aiDecision: null, aiModelState: null });
    expect(reachableStep(beforeAi)).toBe('suggestions');
    expect(guardStep('details', beforeAi)).toBe('/report/suggestions');
    const afterAi = draft({ quantities: {}, aiDecision: null, aiModelState: 'empty' });
    expect(reachableStep(afterAi)).toBe('details');
    expect(guardStep('review', afterAi)).toBe('/report/details');
  });

  it('keeps a timed-out or empty AI result on the manual details step', () => {
    const fallback = draft({ quantities: { Plastic: 'Medium' }, aiDecision: null, aiModelState: 'unavailable' });
    expect(reachableStep(fallback)).toBe('details');
    expect(guardStep('review', fallback)).toBe('/report/details');
  });

  it('lets historic edits enter details without running recognition', () => {
    const edit = draft({ editingReportId: 'r1', photo: null, existingPhotoUrl: '/old.jpg', aiModelState: null, aiDecision: null });
    expect(reachableStep(edit)).toBe('details');
  });

  // This used to assert the opposite - that a correction with NO photo could
  // reach review - which is how the one report the feature exists for, the one
  // excluded because its photo is unusable, could be submitted and counted with
  // the photo still missing. Correcting a report that HAS a photo is covered by
  // the next test, through existingPhotoUrl.
  it('sends a correction with no photo at all back to the photo step', () => {
    const d = draft({ photo: null, existingPhotoUrl: null, existingPhotoKey: null, editingReportId: 'r4' });
    expect(reachableStep(d)).toBe('photo');
    expect(guardStep('review', d)).toBe('/report/photo');
  });

  it('lets a correction keep a photo it was stored with, by key alone', () => {
    const d = draft({ photo: null, existingPhotoKey: 'mock/1.jpg', editingReportId: 'r3', aiDecision: null });
    expect(reachableStep(d)).toBe('details');
    expect(guardStep('photo', d)).toBeNull();
  });

  it('accepts the existing photo while editing a record', () => {
    const d = draft({ photo: null, existingPhotoUrl: 'data:image/png;base64,x' });
    expect(reachableStep(d)).toBe('review');
  });
});

// Whether the app should offer "carry on with your report" when the user comes
// back. An empty draft must not set that off, or someone who has never started
// a report is asked to resume one that does not exist.
describe('Report draft entry', () => {
  it('recognises a draft that should be offered for resume', () => {
    const blank = draft({
      photo: null,
      existingPhotoUrl: null,
      beachId: null,
      beachName: null,
      locationSource: null,
      quantities: {},
      editingReportId: null,
    });
    expect(hasDraftProgress(blank)).toBe(false);
    expect(hasDraftProgress(draft({ quantities: { Plastic: 'Small' } }))).toBe(true);
  });
});

// The map pins are built as plain HTML, not as React, so nothing else checks
// them. A pin has to carry a spoken label and be reachable by keyboard, or the
// map cannot be used with a screen reader or without a mouse. The rest of the
// case proves a pin with too few reports never announces a band it does not
// have, and that the compact pin keeps both of those properties.
describe('Map marker accessibility', () => {
  it('includes a readable beach label and keyboard target', () => {
    const beach: BeachSummary = {
      id: 'morib',
      name: 'Pantai Morib',
      area: 'Banting',
      lat: 2.746,
      lng: 101.44,
      severity: 'High',
      band: 3,
      insufficientData: false,
      validReports: 3,
      attentionScore: 2.8,
      eligibleReportCount: 3,
      lastReportedAt: null,
      freshnessKind: 'ok',
      habitat: 'mudflat',
      habitatTag: 'MUD FLAT',
      sensitivity: 'medium',
      primarySpeciesGlyph: 'bird',
      speciesNames: [],
      coverImageUrl: null,
      scene: '#123456',
    };

    const html = markerHtml(beach, false, 'litter', 'bird');
    expect(html).toContain('aria-label="Pantai Morib · HIGH"');
    expect(html).toContain('tabindex="0"');

    const insufficientHtml = markerHtml({ ...beach, validReports: 1 }, false, 'litter', 'bird');
    expect(insufficientHtml).toContain('aria-label="Pantai Morib · INSUFFICIENT DATA"');
    expect(insufficientHtml).not.toContain('>HIGH</b>');

    // Zoomed out the beaches converge and the pills overlap into an unreadable
    // stack, so the pin drops to a dot. It has to stay reachable: the label and
    // the keyboard affordances sit on the wrapper, not on the pill.
    const compactHtml = markerHtml(beach, false, 'litter', 'bird', [0, 0], true);
    expect(compactHtml).toContain('aria-label="Pantai Morib · HIGH"');
    expect(compactHtml).toContain('tabindex="0"');
    expect(compactHtml).not.toContain('>HIGH</b>');
    expect(compactHtml.length).toBeLessThan(html.length);
  });

});

// Going back from the review screen. The rule is no longer "is there anything
// behind me in the history" - it is "is the DETAILS screen behind me", and only
// RecordScreen can answer that, by stamping the navigation.
describe('Returning from review to details', () => {
  it('pops the history when the details screen stamped the navigation', () => {
    expect(backFromReview({ from: CAME_FROM_DETAILS })).toEqual({ pop: true });
  });

  // The regression this rewrite exists for. resumePath() can send a restored
  // draft straight to /report/review from the home or beach screen. That pushes
  // a history entry, so the old index-based check saw "index > 0" and popped -
  // straight back out to /home, out of the report flow entirely.
  it('does NOT pop when the user arrived from a resumed draft', () => {
    expect(backFromReview(null)).toEqual({ pop: false, to: '/report/details' });
    expect(backFromReview(undefined)).toEqual({ pop: false, to: '/report/details' });
  });

  it('does not pop for a bookmark or a typed URL, which carry no state', () => {
    expect(backFromReview({})).toEqual({ pop: false, to: '/report/details' });
  });

  it('ignores a stamp it does not recognise', () => {
    expect(backFromReview({ from: 'somewhere-else' })).toEqual({ pop: false, to: '/report/details' });
  });

  it('returns either back or replace and never loops to itself', () => {
    for (const state of [null, undefined, {}, { from: '' }, { from: 'home' }, { from: CAME_FROM_DETAILS }]) {
      const r = backFromReview(state);
      expect(r.pop === true || (r.pop === false && r.to === '/report/details')).toBe(true);
    }
  });
});

// Proves the navigation is committed with flushSync, before the draft is
// cleared. Without it the review page's guard sees an empty draft mid-update
// and bounces the user back to step 1 instead of showing their confirmation.
describe('Completing a report submission', () => {
  it('navigates to the saved screen before clearing the review draft', () => {
    const events: string[] = [];
    finishReportSubmission(
      (to, options) => events.push(`navigate:${to}:${options.replace}:${options.flushSync}`),
    );

    expect(events).toEqual(['navigate:/report/saved:true:true']);
  });
});

describe('orderByNeed', () => {
  const beach = (name: string, o: Partial<{ severity: string | null; insufficientData: boolean; validReports: number; attentionScore: number | null }> = {}) => ({
    name,
    severity: o.severity ?? 'Moderate',
    insufficientData: o.insufficientData ?? false,
    validReports: o.validReports ?? 5,
    attentionScore: o.attentionScore ?? 2,
  });

  it('puts the highest attention score first', () => {
    const out = orderByNeed([
      beach('Low one', { attentionScore: 1.2 }),
      beach('High one', { attentionScore: 3.1 }),
      beach('Middle', { attentionScore: 2.0 }),
    ]);
    expect(out.map((b) => b.name)).toEqual(['High one', 'Middle', 'Low one']);
  });

  it('puts every unrated beach after every rated one, however high its count', () => {
    const out = orderByNeed([
      beach('No band', { insufficientData: true, severity: null, attentionScore: null, validReports: 2 }),
      beach('Rated low', { attentionScore: 0.4 }),
    ]);
    expect(out.map((b) => b.name)).toEqual(['Rated low', 'No band']);
  });

  it('orders unrated beaches by how close they are to the threshold', () => {
    const out = orderByNeed([
      beach('Never reported', { insufficientData: true, severity: null, attentionScore: null, validReports: 0 }),
      beach('Nearly there', { insufficientData: true, severity: null, attentionScore: null, validReports: 2 }),
    ]);
    expect(out.map((b) => b.name)).toEqual(['Nearly there', 'Never reported']);
  });

  it('breaks ties on name so the order cannot wobble between fetches', () => {
    const same = { attentionScore: 2.0 };
    expect(orderByNeed([beach('Zeta', same), beach('Alpha', same)]).map((b) => b.name))
      .toEqual(['Alpha', 'Zeta']);
  });

  it('does not mutate the array it was given', () => {
    const input = [beach('B', { attentionScore: 1 }), beach('A', { attentionScore: 9 })];
    const before = input.map((b) => b.name);
    orderByNeed(input);
    expect(input.map((b) => b.name)).toEqual(before);
  });
});
