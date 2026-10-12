import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PersonalInsightCard } from './components/PersonalInsightCard';
import { RecurrenceEvidence } from './components/RecurrenceEvidence';
import { actionTitle } from './presentation';
import { GhostButton, PrimaryButton, TextButton } from './components/ui';
import type { PersonalInsights } from './iteration3Personal';

const cleanup: PersonalInsights['sections'][number] = {
  id: 'since_cleanup', title: 'Since your cleanup', text: '', aiAssisted: false,
  facts: { beachName: 'Pantai Remis', intervalDays: null, daysSinceCleanup: 5 },
  sources: [{ label: 'Your recorded cleanup and Counted beach reports', url: '/beach/remis' }],
  action: { label: 'Report litter', path: '/report/photo?beach=remis' },
};

describe('personal insights from the participant’s actual records', () => {
  it('preserves AI, GPS, API and OBIS acronyms when formatting shared action labels', () => {
    expect(actionTitle('start AI check')).toBe('Start AI Check');
    expect(actionTitle('open GPS location')).toBe('Open GPS Location');
    expect(actionTitle('view API and OBIS details')).toBe('View API and OBIS Details');
  });

  it('formats actual text actions consistently while preserving structured content', () => {
    const action = renderToStaticMarkup(<TextButton disabled style={{ fontSize: 12.5, fontWeight: 400 }}>
      How the AI suggestion works
    </TextButton>);
    expect(action).toContain('How the AI Suggestion Works');
    expect(action).toContain('font-size:14px');
    expect(action).toContain('font-weight:650');
    expect(action).toContain('disabled=""');
    const structured = renderToStaticMarkup(<TextButton><em>Grubeulepis malayensis</em></TextButton>);
    expect(structured).toContain('<em>Grubeulepis malayensis</em>');
  });

  it.each([PrimaryButton, GhostButton, TextButton])('formats action text alongside an icon without altering numbers or nested labels', (Button) => {
    const markup = renderToStaticMarkup(<Button>
      {'Submit anyway — new observation'}<svg aria-hidden="true" /><span>OBIS reference</span>{0}
    </Button>);
    expect(markup).toContain('Submit Anyway — New Observation');
    expect(markup).toContain('<svg aria-hidden="true"></svg>');
    expect(markup).toContain('<span>OBIS reference</span>0');
  });

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

  it('opens complete own-report history from the action and legacy source, preserving research sources', () => {
    const navigate = vi.fn();
    let view!: ReturnType<typeof create>;
    act(() => { view = create(<PersonalInsightCard section={{ ...cleanup, id: 'litter_wildlife',
      title: 'Your litter and wildlife', facts: { category: 'Plastic', reportCount: 2 },
      sources: [{ label: 'Your counted reports', url: '/reports?tab=Counted' },
        { label: 'Research source', url: 'https://example.com/research' }],
      action: { label: 'Explore marine life', path: '/marine-life' } }} onNavigate={navigate} />); });
    try {
      const action = view.root.findAllByType('button').find(node =>
        node.findAllByType('strong').some(label => label.children.join('') === 'Review My Reports'))!;
      act(() => action.props.onClick());
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/reports');
      act(() => view.root.findAllByType('button').find(node => node.children.includes('Your counted reports'))!.props.onClick());
      expect(navigate.mock.calls).toEqual([['/reports'], ['/reports']]);
      expect(view.root.findByType('a').props.href).toBe('https://example.com/research');
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
