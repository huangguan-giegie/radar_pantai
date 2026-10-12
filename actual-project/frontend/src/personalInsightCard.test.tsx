import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PersonalInsightCard } from './components/PersonalInsightCard';
import { RecurrenceEvidence } from './components/RecurrenceEvidence';
import type { PersonalInsights } from './iteration3Personal';

const cleanup: PersonalInsights['sections'][number] = {
  id: 'since_cleanup', title: 'Since your cleanup', text: '', aiAssisted: false,
  facts: { beachName: 'Pantai Remis', intervalDays: null, daysSinceCleanup: 5 },
  sources: [{ label: 'Your recorded cleanup and Counted beach reports', url: '/beach/remis' }],
  action: { label: 'Report litter', path: '/report/photo?beach=remis' },
};

describe('personal insights from the participant’s actual records', () => {
  it('distinguishes waiting for a follow-up from a confirmed same-day follow-up', () => {
    const pending = renderToStaticMarkup(<PersonalInsightCard section={cleanup} onNavigate={() => {}} />);
    expect(pending).toContain('5');
    expect(pending).toContain('Since your recorded cleanup');
    expect(pending).toContain('No follow-up report yet');
    const sameDay = renderToStaticMarkup(<PersonalInsightCard section={{ ...cleanup,
      facts: { ...cleanup.facts, intervalDays: 0 } }} onNavigate={() => {}} />);
    expect(sameDay).toContain('Same Day');
    expect(sameDay).toContain('From your cleanup to the next counted report');
    expect(sameDay).not.toContain('No follow-up report yet');
    expect(sameDay).not.toContain('href="/beach/remis"');
  });

  it('opens the participant’s counted reports instead of a beach or species page', () => {
    const navigate = vi.fn();
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<PersonalInsightCard section={{ ...cleanup, id: 'litter_wildlife',
      title: 'Your litter and wildlife', facts: { category: 'Plastic', reportCount: 2 }, sources: [],
      action: { label: 'Explore marine life', path: '/marine-life' } }} onNavigate={navigate} />); });
    try {
      const action = view.root.findAllByType('button').find(node =>
        node.findAllByType('strong').some(label => label.children.join('') === 'Review My Reports'))!;
      act(() => action.props.onClick());
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/reports?tab=Counted');
      expect(JSON.stringify(view.toJSON())).toContain('Your litter and marine life');
    } finally { act(() => view.unmount()); }
  });

  it('keeps report entry tied to the beach of the participant’s cleanup', () => {
    const navigate = vi.fn();
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<PersonalInsightCard section={cleanup} onNavigate={navigate} />); });
    try {
      act(() => view.root.findByType('button').props.onClick());
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/report/photo?beach=remis');
    } finally { act(() => view.unmount()); }
  });

  it('embeds recurrence inside the existing cleanup card without another card', () => {
    const html = renderToStaticMarkup(<RecurrenceEvidence embedded evidence={{ cleanupAt: '2026-10-07',
      cleanupDate: '2026-10-07', intervalDays: null, daysSinceCleanup: 5,
      status: 'No follow-up report yet', calloutStatus: 'Awaiting follow-up' }} />);
    expect(html).toContain('recurrence-inline');
    expect(html).not.toContain('coastal-card');
    expect(html).toContain('Recurrence is shown after a follow-up report is recorded.');
  });
});
