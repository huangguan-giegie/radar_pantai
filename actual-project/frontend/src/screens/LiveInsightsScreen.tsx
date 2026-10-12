import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { iteration3Request } from '../iteration3Api';
import { useAsyncData } from '../useAsyncData';
import { ActionTile, CoastalPage, DataUnavailable, LinkRow, SummaryCard, SummaryStats, WhiteCard } from '../components/CoastalUI';
import { BarChart, Check, CommunityIcon, Info, Search, SpeciesIcon } from '../components/Icon';
import { GhostButton, Skeleton } from '../components/ui';
import { SeverityBadge } from '../components/ds';
import type { SeverityBand, SpeciesCoordinateContext } from '../types';
import { C, formatDate } from '../theme';
import '../styles/reference-pages.css';

type PublicCount = number | 'Fewer than 3';
type Beach = {
  id: string; name: string; area: string; severity: SeverityBand | null;
  eligibleReportCount: number; latestContributingReportAt: string | null;
  trend: { eligible: boolean; currentBand: SeverityBand | null; previousBand: SeverityBand | null; direction: string | null; previousAsOf: string; message: string | null };
  composition: { category: string; percentage: number; band: string }[];
  leadingCategories: string[];
  evidence: { sufficiency: string; freshnessLabel: string };
  needsVolunteers: { flag: boolean; reasons: string[]; nextEventJoinedCount: PublicCount; href: string; eventMessage: string | null };
};
type Recurrence = { beachId: string; intervalDays: number | null; daysSinceCleanup: number; status: string; medianDays: number | null; evidenceNote: string };
type EvidenceBeach = {
  beachId: string; beachName: string;
  statuses: { countedActive: number; countedResolved: number; duplicate: number; incomplete: number };
  eligibleReportCount: number; latestContributingReportAt: string | null;
  sufficiency: string; freshnessLabel: string;
};
type Summary = {
  asOf: string;
  overview: { countedReports: number; recordedCleanups: number; joinedParticipants: PublicCount; sufficientBeaches: number; needsVolunteers: number };
  headlines: { text: string; href: string }[]; headlinesEmptyState: string | null;
  beaches: Beach[];
  trends: { monthlyReports: { months: string[]; beaches: { beachId: string; counts: number[] }[]; caption: string } };
  cleanup: {
    recent: { beachId: string; beachName: string; date: string; categories: { category: string; beforeBand: string; afterBand: string }[]; handling: string; status: string }[];
    emptyState: string | null;
    hardestToClear: { eligible: boolean; categories: { category: string; percentage: number }[]; emptyState: string | null };
    handling: { eligible: boolean; statuses: { status: string; count: number; percentage: number }[]; label: string; emptyState: string | null };
    recurrence: { beaches: Recurrence[]; emptyState: string | null };
  };
  participation: { steps: { key: string; label: string; count: PublicCount; beaches: { beachId: string; count: number }[] | null }[]; conversions: { from: string; to: string; percentage: number | null; beaches?: { beachId: string; percentage: number }[] | null }[]; caption: string };
  evidence?: { windowDays: number; countedNote: string; sufficientBeachCount: number; beaches: EvidenceBeach[] };
  wildlife?: { beaches?: {
    beachId: string; beachName: string;
    species: { id: string; name: string; relativeOccurrenceScore: number | null; locationMatchScore?: number | null; source: { label: string; url: string }; reviewDate: string; destination: string }[];
    sourceStatus: string; coordinateContext?: SpeciesCoordinateContext | null; modelVersion?: string | null; modelCount?: number | null;
  }[] };
};

const EVIDENCE_STATUSES = [
  { key: 'countedActive', label: 'Counted Active', color: C.navy },
  { key: 'countedResolved', label: 'Counted Resolved', color: C.green },
  { key: 'duplicate', label: 'Duplicate', color: C.muted },
  { key: 'incomplete', label: 'Incomplete', color: C.pale },
] as const;

function EvidenceStatusBar({ beach, windowDays }: { beach: EvidenceBeach; windowDays: number }) {
  const total = EVIDENCE_STATUSES.reduce((sum, status) => sum + beach.statuses[status.key], 0);
  return <>
    <div className="metric-track" role="img" aria-label={`${beach.beachName} report status counts in the last ${windowDays} days: ${EVIDENCE_STATUSES.map(status => `${status.label}: ${beach.statuses[status.key]}`).join(', ')}`} style={{ display: 'flex', height: 18, margin: '12px 0' }}>
      {EVIDENCE_STATUSES.map(status => <span key={status.key} style={{ width: `${total ? beach.statuses[status.key] * 100 / total : 0}%`, background: status.color }} />)}
    </div>
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 12px', margin: 0, fontSize: 12 }}>
      {EVIDENCE_STATUSES.map(status => <div key={status.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><dt style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, background: status.color }} />{status.label}</dt><dd style={{ margin: '0 0 0 auto', fontWeight: 700 }}>{beach.statuses[status.key]}</dd></div>)}
    </dl>
    {!total && <p className="coastal-footnote">No reports recorded in the last {windowDays} days.</p>}
  </>;
}

function Shares({ rows }: { rows: { category: string; percentage: number }[] }) {
  return <>{rows.map(row => <div className="metric-bar" key={row.category}><div><span>{row.category}</span><strong>{row.percentage}%</strong></div><div className="metric-track"><i style={{ width: `${row.percentage}%` }} /></div></div>)}</>;
}

function volunteerReasons(reasons: string[]) {
  const labels: Record<string, string> = { no_recent_cleanup: 'No cleanup recorded in the last 30 days', low_sign_up: 'Low sign-up for the next event' };
  return reasons.map(reason => labels[reason] ?? reason).join(' · ');
}

export default function LiveInsightsScreen() {
  const { topic = '', beachId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { reportsVersion } = useApp();
  const { data, loading, error, refresh } = useAsyncData<Summary | null>(() => iteration3Request('/insights/summary'), [reportsVersion], null);
  const titles: Record<string, string> = { trends: beachId ? 'Beach Trend' : 'Beach Trends', cleanup: 'Cleanup Results', 'cleanup-history': 'Cleanup History', participation: 'Participation', evidence: 'Evidence', wildlife: 'Marine Life Nearby', volunteers: 'Needs Volunteers' };
  const title = titles[topic] ?? 'Insights';
  const filtered = data?.beaches.filter(beach => (!beachId || beach.id === beachId) && (!params.get('q') || beach.name.toLowerCase().includes(params.get('q')!.toLowerCase())) && (!params.get('band') || beach.severity === params.get('band')) && (!params.get('region') || beach.area.includes(params.get('region')!)) && (params.get('needs') !== '1' || beach.needsVolunteers.flag)) ?? [];
  const sections = [['trends', 'Trends'], ['cleanup', 'Cleanup'], ['participation', 'Participation'], ['evidence', 'Evidence'], ['wildlife', 'Marine Life']];
  const changeFilter = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const updates = data?.beaches.filter(beach => beach.trend.eligible && ['up', 'down'].includes(beach.trend.direction ?? '')) ?? [];
  return <CoastalPage key={`${topic}/${beachId ?? ''}`} title={title} eyebrow={data ? `${data.beaches.length} pilot beaches · as of ${formatDate(data.asOf)}` : 'Insights'} className="reference-insights" back={topic ? '/insights' : undefined} action={<button onClick={() => nav('/method')} className={topic ? '' : 'icon-button navy'} aria-label="About data">{topic ? 'About Data' : <Info size={22} color="white" />}</button>}>
    {loading ? <><Skeleton h={180} r={22} /><Skeleton h={120} r={22} /></> : error || !data ? <DataUnavailable title="Insights could not be loaded" retry={() => { void refresh(); }}>Please try again.</DataUnavailable> : <>
      {['trends', 'cleanup', 'cleanup-history', 'participation', 'evidence', 'wildlife'].includes(topic) && <div className="filter-chips" aria-label="Insight topics" style={{ margin: 0 }}>{sections.map(([id, label]) => <button key={id} aria-pressed={topic === id || (id === 'cleanup' && topic === 'cleanup-history')} onClick={() => nav('/insights/' + id)}>{label}</button>)}</div>}
      {!topic && <>
        <SummaryCard eyebrow={`Last 90 days · ${data.beaches.length} pilot beaches`} value={data.overview.countedReports} description="counted reports shape the beach ratings">
          <SummaryStats items={[{ label: 'Cleanups', value: data.overview.recordedCleanups }, { label: 'Joined Participants', value: data.overview.joinedParticipants }, { label: 'Need help', value: data.overview.needsVolunteers }]} />
        </SummaryCard>
        <p className="eyebrow">Beach updates</p>
        {updates.map(beach => <WhiteCard key={beach.id} className="update-card"><button className="coastal-link-row" onClick={() => nav('/insights/trends/' + beach.id)}><span className="row-thumb"><SpeciesIcon glyph="grass" size={28} /></span><span className="grow"><strong>{beach.name}</strong><span className="update-bands"><SeverityBadge band={beach.trend.previousBand} /><span>→</span><SeverityBadge band={beach.trend.currentBand} /></span><small>Last 30 days · counted reports</small></span><span>›</span></button></WhiteCard>)}
        {data.headlines.map((card, i) => <WhiteCard key={i}><LinkRow title={card.text} onClick={() => nav(card.href)} /></WhiteCard>)}
        {!data.headlines.length && !updates.length && <DataUnavailable title={data.headlinesEmptyState ?? 'Not enough recent reports to generate insights yet.'} />}
        <p className="eyebrow">Explore insights</p>
        <div className="action-grid" aria-label="Explore insights">
          <ActionTile title="Trends" subtitle="Band changes" icon={<BarChart size={19} />} onClick={() => nav('/insights/trends')} />
          <ActionTile title="Cleanup" subtitle="Results" icon={<Check color={C.navy} />} onClick={() => nav('/insights/cleanup')} />
          <ActionTile title="Participation" subtitle="Who joined" icon={<CommunityIcon size={19} />} onClick={() => nav('/insights/participation')} />
          <ActionTile title="Evidence" subtitle="Reports and freshness" icon={<Info size={19} />} onClick={() => nav('/insights/evidence')} />
          <ActionTile title="Marine Life" subtitle="Species nearby" icon={<SpeciesIcon glyph="grass" size={20} />} onClick={() => nav('/insights/wildlife')} />
          <ActionTile title="Volunteers" subtitle="Beaches needing help" icon={<CommunityIcon size={19} />} onClick={() => nav('/community/needs-volunteers')} />
        </div>
      </>}
      {topic === 'trends' && !beachId && <>
        <label className="coastal-search"><Search /><input aria-label="Search beaches" placeholder="Search beaches" value={params.get('q') ?? ''} onChange={event => changeFilter('q', event.target.value)} /></label>
        <div className="reference-insights-filters">
          <label>State<select value={params.get('region') ?? ''} onChange={event => changeFilter('region', event.target.value)}><option value="">All states</option>{[...new Set(data.beaches.map(beach => beach.area))].map(area => <option key={area} value={area}>{area}</option>)}</select></label>
          <label>Band<select value={params.get('band') ?? ''} onChange={event => changeFilter('band', event.target.value)}><option value="">All bands</option>{['Low', 'Moderate', 'High', 'Severe'].map(band => <option key={band}>{band}</option>)}</select></label>
        </div>
        <label className="reference-needs-filter"><input type="checkbox" checked={params.get('needs') === '1'} onChange={event => changeFilter('needs', event.target.checked ? '1' : '')} />Needs volunteers only</label>
        {!filtered.length && <DataUnavailable title="No matching beaches">Try another search or clear the filters.</DataUnavailable>}
      </>}
      {topic === 'trends' && filtered.map(beach => {
        const monthly = data.trends.monthlyReports.beaches.find(row => row.beachId === beach.id);
        const recurrence = data.cleanup.recurrence.beaches.find(row => row.beachId === beach.id);
        return <WhiteCard key={beach.id}>
          <LinkRow title={beach.name} subtitle={beach.area} trailing={<SeverityBadge band={beach.severity} />} onClick={() => nav('/beach/' + beach.id)} />
          {beach.trend.eligible ? <><p className="coastal-footnote">{formatDate(beach.trend.previousAsOf)} → {formatDate(data.asOf)}</p><div className="update-bands"><SeverityBadge band={beach.trend.previousBand} /><span>→ {beach.trend.direction}</span><SeverityBadge band={beach.trend.currentBand} /></div></> : <p>{beach.trend.message ?? 'Insufficient data to compare'}</p>}
          <p className="coastal-footnote">Largest share of weighted reported composition: {beach.leadingCategories.join(' and ') || 'Insufficient data'}</p>
          <Shares rows={beach.composition} />
          {monthly && <><p className="eyebrow">Monthly reporting activity</p><div className="coastal-bars" role="img" aria-label={data.trends.monthlyReports.months.map((month, i) => `${month}: ${monthly.counts[i]} reports`).join(', ')}>{monthly.counts.map((count, i) => <div key={i}><small>{count}</small><i style={{ height: Math.min(count * 10, 100) }} /><small>{data.trends.monthlyReports.months[i].slice(5)}</small></div>)}</div><p className="coastal-footnote">{data.trends.monthlyReports.caption}</p></>}
          {recurrence && <p>{recurrence.status}{recurrence.medianDays !== null ? ` · Provisional median: ${recurrence.medianDays} days` : ''}</p>}
        </WhiteCard>;
      })}
      {(topic === 'cleanup' || topic === 'cleanup-history') && <>
        {data.cleanup.recent.filter(row => !beachId || row.beachId === beachId).map((row, i) => <WhiteCard key={i}><p className="eyebrow">Cleanup Recorded</p><h3>{row.beachName}</h3><p className="coastal-footnote">{formatDate(row.date)}</p>{row.categories.map(category => <p key={category.category}>{category.category} · {category.beforeBand} → {category.afterBand}</p>)}<p>{row.handling}</p><p className="coastal-footnote">{row.status}</p></WhiteCard>)}
        {!data.cleanup.recent.length && <DataUnavailable title={data.cleanup.emptyState ?? 'Not enough cleanups recorded yet.'} />}
        <WhiteCard><h3>Hardest-to-clear categories</h3>{data.cleanup.hardestToClear.eligible ? <Shares rows={data.cleanup.hardestToClear.categories} /> : <p>{data.cleanup.hardestToClear.emptyState}</p>}<p className="coastal-footnote">Categories included in at least three cleanups. Remaining above Small after cleanup.</p></WhiteCard>
        <WhiteCard><h3>Handling status</h3>{data.cleanup.handling.eligible ? data.cleanup.handling.statuses.map(row => <p key={row.status}>{row.status}: {row.percentage}% ({row.count})</p>) : <p>{data.cleanup.handling.emptyState}</p>}<p className="coastal-footnote">{data.cleanup.handling.label}</p></WhiteCard>
        {data.cleanup.recurrence.beaches.map(row => <WhiteCard key={row.beachId}><h3>{data.beaches.find(beach => beach.id === row.beachId)?.name}</h3><p>{row.status} · {row.daysSinceCleanup} days since cleanup</p>{row.medianDays !== null && <p>Provisional median: {row.medianDays} days</p>}<p className="coastal-footnote">{row.evidenceNote}</p></WhiteCard>)}
      </>}
      {topic === 'participation' && <><SummaryCard eyebrow="Joining to cleanup · last 90 days">{data.participation.steps.map(step => <div key={step.key}><p>{step.label}: <strong>{step.count}</strong></p>{step.beaches?.map(row => <p key={row.beachId} className="coastal-footnote">{data.beaches.find(beach => beach.id === row.beachId)?.name}: {row.count}</p>)}</div>)}{data.participation.conversions.map((conversion, i) => <div key={i}><p>{conversion.from} → {conversion.to}: {conversion.percentage === null ? 'Insufficient data' : `${conversion.percentage}%`}</p>{conversion.beaches?.map(row => <p key={row.beachId}>{data.beaches.find(beach => beach.id === row.beachId)?.name}: {row.percentage}%</p>)}</div>)}<p className="coastal-footnote">{data.participation.caption}</p></SummaryCard><p className="coastal-footnote">Small counts are withheld. Beach breakdowns are shown only when every beach meets the minimum of three.</p></>}
      {topic === 'evidence' && (data.evidence?.beaches.length ? <>
        <SummaryCard eyebrow={`Evidence coverage · last ${data.evidence.windowDays} days`} value={data.evidence.sufficientBeachCount} description={`of ${data.beaches.length} pilot beaches have sufficient data`} />
        <p className="coastal-footnote">{data.evidence.countedNote}</p>
        {data.evidence.beaches.filter(beach => !beachId || beach.beachId === beachId).map(beach => <WhiteCard key={beach.beachId}>
          <LinkRow title={beach.beachName} subtitle={`Report status · last ${data.evidence!.windowDays} days`} onClick={() => nav('/beach/' + beach.beachId)} />
          <EvidenceStatusBar beach={beach} windowDays={data.evidence!.windowDays} />
          <p><strong>{beach.eligibleReportCount}</strong> active eligible Counted reports in the last {data.evidence!.windowDays} days</p>
          <p><strong>{beach.sufficiency}</strong> · {beach.freshnessLabel}</p>
          <p className="coastal-footnote">Latest contributing report: {beach.latestContributingReportAt ? <time dateTime={beach.latestContributingReportAt}>{new Date(beach.latestContributingReportAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric' })}</time> : 'No contributing report'}</p>
        </WhiteCard>)}
        {beachId && !data.evidence.beaches.some(beach => beach.beachId === beachId) && <DataUnavailable title="Beach evidence not found">Open Evidence to view the pilot beaches.</DataUnavailable>}
      </> : <DataUnavailable title="Evidence is not available yet" retry={() => { void refresh(); }}>The report summary is not available. Please try again.</DataUnavailable>)}
      {topic === 'volunteers' && <>{data.beaches.filter(beach => beach.needsVolunteers.flag).map(beach => <WhiteCard key={beach.id}><LinkRow title={beach.name} subtitle={volunteerReasons(beach.needsVolunteers.reasons)} onClick={() => nav(beach.needsVolunteers.href)} /><p>Joined: {beach.needsVolunteers.nextEventJoinedCount}</p>{beach.needsVolunteers.eventMessage && <p>{beach.needsVolunteers.eventMessage}</p>}</WhiteCard>)}{!data.beaches.some(beach => beach.needsVolunteers.flag) && <DataUnavailable title="No beaches currently flagged for volunteers" />}</>}
      {topic === 'wildlife' && <>{data.beaches.map(beach => {
        const wildlife = data.wildlife?.beaches?.find(row => row.beachId === beach.id);
        return <WhiteCard key={beach.id}><h3>{beach.name}</h3><p>Beach Attention: <SeverityBadge band={beach.severity} /></p><p className="coastal-footnote">Biodiversity is separate from Beach Attention. Historical marine context is not confirmed sightings. Location match compares reference locations for each species; neither location match nor raw model score is an occurrence probability.</p>
          {wildlife?.coordinateContext && <p className="coastal-footnote">Marine-grid reference: {wildlife.coordinateContext.usedLatitude.toFixed(4)}, {wildlife.coordinateContext.usedLongitude.toFixed(4)} · {wildlife.coordinateContext.distanceKm.toFixed(1)} km from the beach · 15 km search limit</p>}
          {wildlife?.species.length ? wildlife.species.map(species => <div key={species.id}><LinkRow title={species.name} subtitle={species.locationMatchScore == null ? 'Location match unavailable' : `Location match: ${Math.round(species.locationMatchScore * 100)}/100`} onClick={() => nav(species.destination)} /><p className="coastal-footnote">{species.relativeOccurrenceScore !== null && <>Raw relative model score: {species.relativeOccurrenceScore.toFixed(2)} (0–1) · </>}<a href={species.source.url} target="_blank" rel="noreferrer">{species.source.label}</a> · reviewed {formatDate(species.reviewDate)}</p></div>) : <p>Biodiversity information not yet available</p>}
          <LinkRow title="View beach biodiversity" onClick={() => nav('/beach/' + beach.id)} /></WhiteCard>;
      })}</>}
      <p className="coastal-footnote">Counted reports are accepted community evidence, not expert verification. These summaries do not establish cleanliness or ecological recovery.</p>
      <GhostButton onClick={() => nav('/map')}>Open Map</GhostButton>
    </>}
  </CoastalPage>;
}
