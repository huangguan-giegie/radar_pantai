import { getMyReports } from './api';
import { personalCleanupRecords } from './iteration2';
import type { PersonalInsights } from './iteration3Personal';

/** Local demo only. Live private insights continue to come from /personal-insights. */
export async function personalInsightsPreview(participantId: string): Promise<PersonalInsights> {
  const reports = await getMyReports('Counted');
  const sections: PersonalInsights['sections'] = [];
  const categories = new Map<string, number>();
  reports.forEach(report => Object.entries(report.quantities).forEach(([category, quantity]) => {
    if (quantity) categories.set(category, (categories.get(category) ?? 0) + 1);
  }));
  const top = [...categories.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const risk = top[0] === 'Plastic' ? 'Possible ingestion' : top[0] === 'Fishing gear' ? 'Possible entanglement' : 'Potential litter exposure';
    sections.push({ id: 'litter_wildlife', title: 'Your litter and marine life', text: '',
      facts: { category: top[0], reportCount: top[1], speciesGroups: ['Coastal marine life'], riskType: risk },
      sources: [{ label: 'Your preview counted reports', url: '/reports' }],
      action: { label: 'Review My Reports', path: '/reports' }, aiAssisted: false });
  }
  const cleanup = personalCleanupRecords(participantId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (cleanup) {
    const calendarDay = (value: Date) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(value).map(part => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    };
    sections.push({ id: 'since_cleanup', title: 'Since your cleanup', text: '',
      facts: { beachId: cleanup.beachId, beachName: cleanup.beachName, intervalDays: cleanup.recurrence?.intervalDays ?? null,
        daysSinceCleanup: Math.max(0, (calendarDay(new Date()) - calendarDay(new Date(cleanup.createdAt))) / 86400000) },
      sources: [],
      action: { label: 'Report Litter', path: '/report/photo?beach=' + cleanup.beachId }, aiAssisted: false });
  }
  return { sections, emptyStateMessage: 'Report litter or finish a cleanup to unlock personal insights.', links: { map: '/map', insights: '/insights' } };
}
