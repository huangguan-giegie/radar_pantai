import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanupAction } from './iteration2';
import type { LitterReport } from './types';

const records = vi.hoisted(() => ({ reports: [] as LitterReport[], cleanups: [] as CleanupAction[] }));
vi.mock('./api', () => ({ getMyReports: vi.fn(async () => records.reports) }));
vi.mock('./iteration2', () => ({ personalCleanupRecords: vi.fn(() => records.cleanups) }));
import { personalInsightsPreview } from './personalInsightsPreview';

function report(createdAt: string, changes: Partial<LitterReport> = {}): LitterReport {
  return { id: createdAt, beachId: 'remis', beachName: 'Pantai Remis', createdAt,
    status: 'Counted', quantities: { Plastic: 'Large' }, category: 'Plastic', quantity: 'Large',
    categoryScores: { Plastic: 2.55 }, reportScore: 2.55, ...changes };
}
function cleanup(createdAt: string, changes: Partial<CleanupAction> = {}): CleanupAction {
  return { id: createdAt, participantId: '1111', beachId: 'remis', beachName: 'Pantai Remis',
    createdAt, targetReportId: null, eventId: null, rows: [], score: 1,
    handling: 'Collected for disposal', note: '', status: 'Cleanup recorded — awaiting follow-up', ...changes };
}
async function facts() {
  return (await personalInsightsPreview('1111')).sections.find(section => section.id === 'since_cleanup')?.facts;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T06:00:00Z'));
  records.reports = [];
  records.cleanups = [cleanup('2026-10-10T01:00:00Z')];
});
afterEach(() => { vi.useRealTimers(); });

describe('personal insights from saved preview reports and cleanups', () => {
  it('recomputes after a follow-up is saved without requiring a recurrence field on the cleanup', async () => {
    expect(await facts()).toMatchObject({ intervalDays: null, daysSinceCleanup: 2,
      followUpStatus: 'No follow-up report in your local records yet' });
    records.reports.push(report('2026-10-11T02:00:00Z'));
    expect(await facts()).toMatchObject({ intervalDays: 1 });
    const litter = (await personalInsightsPreview('1111')).sections.find(section => section.id === 'litter_wildlife')!;
    expect(litter.facts?.reportCount).toBe(1);
    expect(litter.action.path).toBe('/reports');
    expect(litter.sources[0].url).toBe('/reports');
  });

  it('retains resolved Counted history in personal totals and opens the complete own-report list', async () => {
    records.reports = [report('2026-10-10T02:00:00Z', { currentState: 'active' }),
      report('2026-10-09T02:00:00Z', { currentState: 'resolved' }),
      report('2026-10-08T02:00:00Z', { status: 'Duplicate', currentState: 'excluded' })];
    const litter = (await personalInsightsPreview('1111')).sections.find(section => section.id === 'litter_wildlife')!;
    expect(litter.facts?.reportCount).toBe(2);
    expect(litter.action.path).toBe('/reports');
    expect(litter.sources[0].url).toBe('/reports');
  });

  it('ranks original quantity-weighted totals instead of frequency or cached category scores', async () => {
    records.reports = [
      report('2026-10-10T02:00:00Z', { quantities: { Plastic: 'Small' } }),
      report('2026-10-09T02:00:00Z', { quantities: { Plastic: 'Small' } }),
      report('2026-10-08T02:00:00Z', { quantities: { 'Fishing gear': 'Large' },
        currentState: 'resolved', categoryScores: {}, reportScore: 0 }),
      report('2026-10-13T02:00:00Z', { quantities: { Plastic: 'Very Large' } }),
      report('2026-10-07T02:00:00Z', { status: 'Duplicate', quantities: { Plastic: 'Very Large' } }),
    ];
    const litter = (await personalInsightsPreview('1111')).sections.find(section => section.id === 'litter_wildlife')!;
    // Two small plastic reports total 1.7; one large fishing-gear report totals 3.
    expect(litter.facts).toMatchObject({ category: 'Fishing gear', reportCount: 1 });
  });

  it('only selects categories with a currently approved wildlife risk entry', async () => {
    records.reports = [
      report('2026-10-10T02:00:00Z', { quantities: { Glass: 'Very Large' } }),
      report('2026-10-09T02:00:00Z', { quantities: { Glass: 'Very Large' } }),
      report('2026-10-08T02:00:00Z', { quantities: { Plastic: 'Small' } }),
    ];
    const litter = (await personalInsightsPreview('1111')).sections.find(section => section.id === 'litter_wildlife')!;
    expect(litter.facts).toMatchObject({ category: 'Plastic', reportCount: 1 });
    records.reports.pop();
    expect((await personalInsightsPreview('1111')).sections.some(section => section.id === 'litter_wildlife')).toBe(false);
  });

  it('uses only the first later Counted report at the cleanup beach, excluding future dates', async () => {
    records.reports = [
      report('2026-10-12T05:00:00Z'),
      report('2026-10-11T02:00:00Z'),
      report('2026-10-10T01:01:00Z', { beachId: 'morib' }),
      report('2026-10-10T01:02:00Z', { status: 'Duplicate' }),
      report('2026-10-10T01:00:00Z'),
      report('2026-10-09T01:00:00Z'),
      report('2026-10-13T01:00:00Z'),
    ];
    expect(await facts()).toMatchObject({ intervalDays: 1 });
    records.reports = records.reports.filter(item => item.createdAt !== '2026-10-11T02:00:00Z'
      && item.createdAt !== '2026-10-12T05:00:00Z');
    expect(await facts()).toMatchObject({ intervalDays: null });
  });

  it('counts Malaysia calendar days across midnight and preserves a genuine same-day interval of zero', async () => {
    records.cleanups = [cleanup('2026-10-10T15:45:00Z')];
    records.reports = [report('2026-10-10T16:15:00Z')];
    expect(await facts()).toMatchObject({ intervalDays: 1 });
    records.reports = [report('2026-10-10T15:50:00Z')];
    expect(await facts()).toMatchObject({ intervalDays: 0 });
  });

  it('uses the latest recorded cleanup and does not attach an earlier follow-up to it', async () => {
    records.cleanups.push(cleanup('2026-10-11T03:00:00Z'), cleanup('2026-10-13T01:00:00Z'));
    records.reports = [report('2026-10-11T02:00:00Z')];
    expect(await facts()).toMatchObject({ intervalDays: null, daysSinceCleanup: 1 });
  });
});
