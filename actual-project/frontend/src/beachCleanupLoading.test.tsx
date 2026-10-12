import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BeachCleanupCard } from './components/BeachCleanupCard';
import type { CleanupTarget } from './iteration2';

const target: CleanupTarget = {
  reportId: 'report-1', beachId: 'kelanang', beachName: 'Pantai Kelanang',
  reportedAt: '2026-10-01T11:00:00+08:00', remainingBands: { Plastic: 'Large' },
};
const actions = { onCleanup: () => {}, onReport: () => {}, onRetry: () => {} };

function renderCard(data: CleanupTarget | null, loading = false, error: string | null = null) {
  return renderToStaticMarkup(<BeachCleanupCard target={data} loading={loading} error={error} {...actions} />);
}

describe('beach cleanup availability', () => {
  it('does not claim there is no cleanup report while the target request is pending', () => {
    const html = renderCard(null, true);
    expect(html).toContain('Checking cleanup availability');
    expect(html).not.toContain('No active cleanup report');
    expect(html).not.toContain('Nothing to clean up');
    expect(html).not.toContain('Report Litter Here');
    expect(html).not.toContain('Add a Cleanup');
  });

  it('keeps a stale target unavailable until it has been checked again', () => {
    expect(renderCard(target, true)).not.toContain('Add a Cleanup');
    expect(renderCard(target, false, 'Network unavailable')).not.toContain('Add a Cleanup');
  });

  it('shows a retry rather than an empty result when the request fails', () => {
    const html = renderCard(null, false, 'Network unavailable');
    expect(html).toContain('Could not check cleanup availability');
    expect(html).toContain('Try Again');
    expect(html).not.toContain('No active cleanup report');
    expect(html).not.toContain('Report Litter Here');
  });

  it('offers reporting only after the API confirms there is no active target', () => {
    const html = renderCard(null);
    expect(html).toContain('No active cleanup report');
    expect(html).toContain('Report Litter Here');
    expect(html).not.toContain('Nothing to clean up');
    expect(html).not.toContain('Add a Cleanup');
  });

  it('offers cleanup for a single active report without requiring a beach severity rating', () => {
    const html = renderCard(target);
    expect(html).toContain('Add a Cleanup');
    expect(html).not.toContain('No active cleanup report');
    expect(html).not.toContain('Report Litter Here');
  });
});
