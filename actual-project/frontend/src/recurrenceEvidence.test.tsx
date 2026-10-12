import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecurrenceEvidence } from './components/RecurrenceEvidence';

const base = {
  cleanupAt: '2026-10-01T23:59:00+08:00', cleanupDate: '2026-10-01',
  intervalDays: null, daysSinceCleanup: 4,
  status: 'No follow-up report yet', calloutStatus: 'Cleanup recorded — awaiting follow-up',
};

describe('recurrence evidence', () => {
  it('shows missing follow-up evidence and elapsed days without asserting cleanliness', () => {
    const html = renderToStaticMarkup(<RecurrenceEvidence evidence={base} />);
    expect(html).toContain('No follow-up report yet');
    expect(html).toContain('4 days since the recorded cleanup');
    expect(html).toContain('Recurrence is shown after a follow-up report is recorded.');
    expect(html).not.toContain('Provisional estimate');
  });
  it('preserves same-day zero intervals without replacing them with a provisional median', () => {
    const html = renderToStaticMarkup(<RecurrenceEvidence evidence={{ ...base, intervalDays: 0, status: '0 days until next Counted report', medianDays: 2, provisional: true }} />);
    expect(html).toContain('Next Counted report on the same day');
    expect(html).not.toContain('0 days until next Counted report');
    expect(html).toContain('not measured litter return');
    expect(html).not.toContain('Provisional estimate');
    const insufficient = renderToStaticMarkup(<RecurrenceEvidence evidence={{ ...base, medianDays: 0, provisional: false }} />);
    expect(insufficient).not.toContain('Provisional estimate');
    const sameDay = renderToStaticMarkup(<RecurrenceEvidence evidence={{ ...base, medianDays: 0, provisional: true }} />);
    expect(sameDay).toContain('Recurrence is shown after a follow-up report is recorded.');
    expect(sameDay).not.toContain('same day as a cleanup');
    const oneDay = renderToStaticMarkup(<RecurrenceEvidence evidence={{ ...base, intervalDays: 1, status: '1 days until next Counted report' }} />);
    expect(oneDay).toContain('1 day until next Counted report');
  });
  it('omits the section when no cleanup exists and keeps superseded-cleanup wording', () => {
    expect(renderToStaticMarkup(<RecurrenceEvidence evidence={null} />)).toBe('');
    const html = renderToStaticMarkup(<RecurrenceEvidence evidence={{ ...base, status: 'No follow-up report before the next cleanup' }} />);
    expect(html).toContain('No follow-up report before the next cleanup');
  });
});
