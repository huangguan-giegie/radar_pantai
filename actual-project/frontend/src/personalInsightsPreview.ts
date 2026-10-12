import { getMyReports } from './api';
import { personalCleanupRecords } from './iteration2';
import type { PersonalInsights } from './iteration3Personal';
import { categoryScoresFor } from './scoring';

/** Local demo only. Live private insights continue to come from /personal-insights. */
export async function personalInsightsPreview(participantId: string): Promise<PersonalInsights> {
  const now = new Date();
  const reports = (await getMyReports('Counted')).filter(report =>
    report.status === 'Counted' && Date.parse(report.createdAt) <= now.getTime());
  const sections: PersonalInsights['sections'] = [];
  const categories = new Map<string, { weightedScore: number; reportCount: number }>();
  // Match the live aggregate: original reported quantities, including resolved
  // history, determine the weighted total; report counts remain unweighted.
  reports.forEach(report => Object.entries(categoryScoresFor(report.quantities)).forEach(([category, score]) => {
    if (score <= 0) return;
    const total = categories.get(category) ?? { weightedScore: 0, reportCount: 0 };
    categories.set(category, { weightedScore: total.weightedScore + score, reportCount: total.reportCount + 1 });
  }));
  // The live wildlife content currently approves risk entries for these two
  // categories only, so another litter category must not displace them.
  const top = [...categories.entries()]
    .filter(([category]) => category === 'Plastic' || category === 'Fishing gear')
    .sort((a, b) => b[1].weightedScore - a[1].weightedScore || a[0].localeCompare(b[0]))[0];
  if (top) {
    const risk = top[0] === 'Plastic' ? 'Possible ingestion' : top[0] === 'Fishing gear' ? 'Possible entanglement' : 'Potential litter exposure';
    sections.push({ id: 'litter_wildlife', title: 'Your litter and marine life', text: '',
      facts: { category: top[0], reportCount: top[1].reportCount, speciesGroups: ['Coastal marine life'], riskType: risk },
      sources: [{ label: 'Your Preview Report History', url: '/reports' }],
      action: { label: 'Review My Reports', path: '/reports' }, aiAssisted: false });
  }
  const cleanup = personalCleanupRecords(participantId)
    .filter(record => Date.parse(record.createdAt) <= now.getTime())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (cleanup) {
    const calendarDay = (value: Date) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(value).map(part => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    };
    const cleanupAt = new Date(cleanup.createdAt);
    // Local cleanups do not store recurrence. Derive it from the current saved
    // reports so submitting or correcting a report updates this card next time.
    const followUp = reports.filter(report => report.beachId === cleanup.beachId
      && Date.parse(report.createdAt) > cleanupAt.getTime())
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    const intervalDays = followUp
      ? (calendarDay(new Date(followUp.createdAt)) - calendarDay(cleanupAt)) / 86400000
      : null;
    sections.push({ id: 'since_cleanup', title: 'Since your cleanup', text: '',
      facts: { beachId: cleanup.beachId, beachName: cleanup.beachName, intervalDays,
        daysSinceCleanup: Math.max(0, (calendarDay(now) - calendarDay(cleanupAt)) / 86400000),
        followUpStatus: followUp ? 'Follow-up found in your local counted reports' : 'No follow-up report in your local records yet' },
      sources: [],
      action: { label: 'Report Litter', path: '/report/photo?beach=' + cleanup.beachId }, aiAssisted: false });
  }
  return { sections, emptyStateMessage: 'Report litter or finish a cleanup to unlock personal insights.', links: { map: '/map', insights: '/insights' } };
}
