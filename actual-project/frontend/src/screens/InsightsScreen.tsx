import { useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { USE_MOCK } from "../api";
import {
  ActionTile,
  CoastalPage,
  DataUnavailable,
  LinkRow,
  Sheet,
  SummaryCard,
  SummaryStats,
  WhiteCard,
} from "../components/CoastalUI";
import {
  BarChart,
  Check,
  CommunityIcon,
  Info,
  Search,
  SpeciesIcon,
} from "../components/Icon";
import { GhostButton, PrimaryButton, Skeleton } from "../components/ui";
import { SeverityBadge } from "../components/ds";
import { INSIGHTS_PREVIEW as preview } from "../content/insightsPreview";
import { C, formatDate, severityLabel } from "../theme";
import { useApp } from "../AppContext";
import { useAsyncData } from "../useAsyncData";
import { fetchInsights, type InsightsData, type InsightBeach, type InsightCleanup } from "../insightsApi";
import { iteration3Request } from "../iteration3Api";
import type { PersonalInsights } from "../iteration3Personal";
import { getCoastalBeaches } from "../coastalData";
import { PlaceThumb } from "../components/Visuals";
import { beachPhoto, speciesPhoto } from "../visuals";
import { PHOTOS } from '../visuals';
import { personalInsightsPreview } from '../personalInsightsPreview';

export function MetricBars({ rows }: { rows: [string, number][] }) {
  return (
    <>
      {rows.map(([label, value]) => (
        <div className="metric-bar" key={label}>
          <div>
            <span>{label}</span>
            <strong>{value}%</strong>
          </div>
          <div className="metric-track">
            <i style={{ width: value + "%" }} />
          </div>
        </div>
      ))}
    </>
  );
}

const dayCount = (days: number | null) => `${days ?? '—'} ${days === 1 ? 'day' : 'days'}`;
// "0 days until next report" read as an error; a same-day report is said in words.
const nextReportPhrase = (days: number | null) => days == null ? 'next report recorded' : days === 0 ? 'next report the same day' : `${dayCount(days)} until next report`;

export default function InsightsScreen() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, reportsVersion } = useApp();
  const personalOpen = params.get('panel') === 'personal';
  const setPersonalOpen = (open: boolean) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (open) next.set('panel', 'personal'); else next.delete('panel');
    return next;
  }, { replace: true });
  const { data: personal, loading, error, refresh } = useAsyncData(
    () => user && personalOpen ? USE_MOCK ? personalInsightsPreview(user.participantId) : iteration3Request<PersonalInsights>('/personal-insights') : Promise.resolve(null),
    [user?.participantId, reportsVersion, personalOpen],
    null,
  );
  const personalAction = user && <button className="personal-insights-button" onClick={() => setPersonalOpen(true)}>
    Personal Insights
  </button>;
  return <>
    {USE_MOCK ? <PreviewInsightsScreen personalAction={personalAction} /> : <LiveInsightsScreen personalAction={personalAction} />}
    {personalOpen && user && <Sheet title="Your Insights" onClose={() => setPersonalOpen(false)}>
      <div className="personal-insights-intro">
      <p className="eyebrow">Private · only you see this</p>
      {USE_MOCK && <p className="demo-label">Preview · your local example records</p>}
      {personal?.sections.length ? <p className="subtle personal-subtitle">{personal.sections.length} {personal.sections.length === 1 ? 'section' : 'sections'} · from your own records</p> : null}
      </div>
      {loading ? <p role="status">Loading your insights…</p> : error ? (
        <DataUnavailable title="Your insights could not be loaded" retry={() => void refresh()}>
          Please try again to load your personal insights.
        </DataUnavailable>
      ) : personal?.sections.length ? personal.sections.map(section => (
        <WhiteCard key={section.id} className="personal-insight-card">
          <header className="personal-card-header"><span className="personal-icon">{section.id === 'litter_wildlife' ? <SpeciesIcon glyph="turtle" size={18} color={C.lime} /> : <BarChart size={18} color={C.lime} />}</span><p className="eyebrow">{section.title}</p></header>
          {section.aiAssisted && <p className="coastal-footnote">AI-assisted</p>}
          {section.id === 'litter_wildlife' && section.facts ? <>
            <div className="personal-litter-fact"><div><p className="subtle">Top category in your reports</p><strong>{section.facts.category}</strong><small>{section.facts.reportCount} counted reports</small></div><img src={PHOTOS.turtle} alt="Sea turtle · species example" /></div>
            <div className="personal-insight-risk"><p className="eyebrow">May affect</p><strong>{section.facts.speciesGroups?.join(' · ')}</strong><small>{section.facts.riskType}</small></div>
            <p className="coastal-footnote">General research · no local harm shown</p>
          </> : section.id === 'since_cleanup' && section.facts ? <>
            <div className="personal-cleanup-fact"><div><strong>{section.facts.intervalDays ?? section.facts.daysSinceCleanup ?? '—'}</strong><small>DAYS</small></div><div><b>{section.facts.beachName}</b><p className="subtle">{section.facts.intervalDays != null ? 'From your cleanup to the next counted report' : 'Since your recorded cleanup'}</p></div></div>
            {section.facts.intervalDays == null && <p className="coastal-footnote">{section.facts.followUpStatus ?? 'No follow-up report yet'}</p>}
            <p className="coastal-footnote">Community reporting, not measured litter return</p>
          </> : section.id === 'persistent_litter' && section.facts ? <>
            <p className="personal-insight-fact">{section.facts.category}</p><p className="subtle">{section.text || `Remained above Small in ${section.facts.remainingCleanupCount} of ${section.facts.includedCleanupCount} eligible cleanups.`}</p>
          </> : <p className="subtle">{section.text}</p>}
          {section.sources.map(source => <p className="coastal-footnote personal-source" key={source.url}>
            <a href={source.url} target={source.url.startsWith('https://') ? '_blank' : undefined} rel="noreferrer">{source.label}</a>
            {section.reviewDate && ' · Reviewed ' + section.reviewDate}
          </p>)}
          <LinkRow title={section.action.label} onClick={() => nav(section.action.path)} />
        </WhiteCard>
      )) : (
        <DataUnavailable title="Your Insights">
          {personal?.emptyStateMessage ?? 'Report litter or finish a cleanup to unlock personal insights.'}
        </DataUnavailable>
      )}
      <div className="personal-footer-actions"><PrimaryButton height={48} onClick={() => { setPersonalOpen(false); nav('/insights'); }}>View Beach Insights</PrimaryButton>
      <GhostButton height={48} onClick={() => { setPersonalOpen(false); nav(personal?.links.map ?? '/map'); }}>Open the map</GhostButton></div>
    </Sheet>}
  </>;
}

type WildlifeModelRow = {
  beachId: string;
  sourceStatus: string;
  coordinateContext?: { distanceKm: number } | null;
  species: { name: string; scientificName: string; locationMatchScore: number | null; evidenceType: string }[];
};
type WildlifeModelResponse = { beaches: WildlifeModelRow[]; note: string };

function WildlifeCoverage({ beaches }: { beaches: InsightsData['wildlife'] }) {
  const nav = useNavigate();
  const { data: predictions, loading, error, refresh } = useAsyncData<WildlifeModelResponse | null>(
    () => iteration3Request<WildlifeModelResponse>('/insights/wildlife'), [], null,
  );
  // The wildlife endpoint is authoritative for evidence type. The /insights
  // summary has a legacy species list and may classify OBIS-modelled MVP
  // beaches as published references if used to count or render species.
  const loaded = !loading && !error && predictions !== null;
  const byBeach = new Map((predictions?.beaches ?? []).map(row => [row.beachId, row]));
  const hasSource = (beachId: string, status: string) => {
    const row = byBeach.get(beachId);
    return row?.sourceStatus === status && row.species.length > 0;
  };
  const curatedCount = loaded ? beaches.filter(beach => hasSource(beach.beachId, 'published_reference')).length : 0;
  const modelledCount = loaded ? beaches.filter(beach => hasSource(beach.beachId, 'modelled')).length : 0;
  const unavailableCount = loaded ? beaches.length - curatedCount - modelledCount : 0;
  return <>
    <SummaryCard eyebrow="Wildlife coverage · curated references & OBIS model" value={beaches.length}
      description={loaded
        ? `beaches · ${curatedCount} with curated reference data · ${modelledCount} with OBIS-derived model context`
        : loading ? 'beaches · checking wildlife sources…' : 'beaches · wildlife source data unavailable'} />
    <p className="coastal-footnote">All registered beaches are listed. Curated coastal references provide background ecological information; OBIS-derived model suggestions use frozen historical scores from nearby marine grids. Neither confirms species sightings or wildlife impact at individual beaches.</p>
    {loading && <p className="coastal-footnote">Loading wildlife evidence and OBIS-derived model context…</p>}
    {!loading && !loaded && <DataUnavailable title="Wildlife source data temporarily unavailable" retry={() => { void refresh(); }}>The wildlife endpoint could not be loaded. Missing API data is not evidence that a beach has no species.</DataUnavailable>}
    {loaded && unavailableCount > 0 && <p className="coastal-footnote">{unavailableCount} {unavailableCount === 1 ? 'beach has' : 'beaches have'} no currently available species suggestion. This is not evidence that wildlife is absent.</p>}
    {beaches.map(beach => {
      const model = loaded ? byBeach.get(beach.beachId) : undefined;
      const sourceStatus = model?.sourceStatus;
      const hasValidEvidence = sourceStatus === 'published_reference' || sourceStatus === 'modelled';
      const names = hasValidEvidence ? model?.species.map(item => item.name) ?? [] : [];
      const contextLabel = !loaded
        ? loading ? 'Checking wildlife sources…' : 'Wildlife source data temporarily unavailable'
        : names.length && sourceStatus === 'published_reference' ? 'Curated coastal reference'
        : names.length && sourceStatus === 'modelled'
          ? `OBIS-derived marine-grid model${model?.coordinateContext ? ` · ${model.coordinateContext.distanceKm.toFixed(1)} km reference distance` : ''}`
          : 'Species context not yet available';
      const habitat = beach.habitat === 'Biodiversity information not yet available'
        ? 'Marine habitat not individually documented' : beach.habitat;
      return <button className="wildlife-beach-card" key={beach.beachId} onClick={() => nav('/beach/' + beach.beachId)}>
        <span><strong>{beach.name}</strong><small>{habitat} · {beach.activeReports} active litter reports</small><small>{contextLabel}</small></span>
        <span className="wildlife-species">{names.length ? names.map(name => {
          const photo = speciesPhoto(name);
          return <span key={name} className={photo ? 'has-photo' : undefined}>{photo && <img src={photo} alt="" loading="lazy" />}{name}</span>;
        }) : <span>{loading ? 'Checking wildlife sources…' : loaded ? 'No species suggestion available' : 'Wildlife data unavailable'}</span>}</span>
      </button>;
    })}
    <p className="coastal-footnote">Curated references may describe coastal habitats or broader regions rather than sightings at the named beach. Model suggestions use frozen historical OBIS-derived scores from a marine grid within 15 km of each supplied reference coordinate. They are not occurrence probabilities or verified local observations.</p>
  </>;
}

function LiveInsightsScreen({ personalAction }: { personalAction: ReactNode }) {
  const { topic = '', beachId } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { reportsVersion } = useApp();
  const [filters, setFilters] = useState(false);
  const cleanupBeach = topic.startsWith('cleanup') ? params.get('beach') ?? undefined : undefined;
  const requestedBeach = cleanupBeach ?? beachId;
  const { data, loading, error, refresh } = useAsyncData<InsightsData | null>(
    () => fetchInsights(requestedBeach), [requestedBeach, reportsVersion], null,
  );
  // Photos and coordinates for row thumbnails; /insights itself carries neither for most beaches.
  const { data: catalogue } = useAsyncData(() => getCoastalBeaches(), [], []);
  const places = new Map(catalogue.map(b => [b.id, b]));
  const update = (key: string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const active = topic === 'participation' ? 'participation' : topic.startsWith('cleanup') ? 'cleanup' : 'trends';
  const title = !topic ? 'Insights' : topic === 'trends' ? beachId ? 'Beach Trend' : 'Beach Trends'
    : topic === 'participation' ? 'Participation' : topic === 'wildlife' ? 'Wildlife Nearby'
      : topic === 'cleanup-history' ? 'Cleanup History' : 'Cleanup Results';
  const chips = <div className="coastal-segments" aria-label="Insight topics">
    {['trends', 'cleanup', 'participation'].map(t => <button key={t} aria-pressed={active === t} onClick={() => nav('/insights/' + t)}>
      {t === 'trends' ? 'Trends' : t === 'cleanup' ? 'Cleanup' : 'Participation'}
    </button>)}
  </div>;
  const thumbnail = (beach: InsightBeach) => {
    const place = places.get(beach.id);
    return <PlaceThumb image={beachPhoto(beach.id, beach.photo ?? place?.image)} lat={place?.lat} lng={place?.lng} />;
  };
  const mapCredit = <p className="map-credit">Beach photos where available · other thumbnails show the location · map © OpenStreetMap contributors</p>;
  const bands = (beach: InsightBeach) => <span className="update-bands">
    <SeverityBadge band={beach.from} /><span>→</span><SeverityBadge band={beach.to} />
  </span>;
  const cleanupRows = (cleanup: InsightCleanup) => <WhiteCard>
    <p className="eyebrow">{cleanup.linked ? 'Recorded change' : 'Recorded removal'}</p>
    {cleanup.rows.length ? cleanup.rows.map(row => <div className="coastal-link-row" key={row.category}>
      <strong className="grow">{row.category}</strong>
      <small>{row.beforeBand ? `${row.beforeBand} → ${row.afterBand}` : row.removedBand}</small>
    </div>) : <p className="subtle">This historical record has no saved amounts.</p>}
    <p className="coastal-footnote">{cleanup.linked ? 'Participant-confirmed amounts for the linked report.' : 'This cleanup is not linked to a target report and does not change another report’s rating.'}</p>
    <p className="coastal-footnote">Handling · {cleanup.handling}</p>
  </WhiteCard>;
  let body: ReactNode;
  if (loading) body = <><Skeleton h={215} r={22} /><Skeleton h={110} r={22} /><Skeleton h={110} r={22} /></>;
  else if (error || !data) body = <DataUnavailable title="Insights could not load" retry={() => { void refresh(); }}>{error ?? 'Please try again.'}</DataUnavailable>;
  else if (!topic) {
    const changed = data.beaches.filter(b => b.from && b.to && b.from !== b.to);
    body = <>
      <SummaryCard eyebrow={`Last ${data.windowDays} days · ${data.overview.registeredBeaches} beaches`} value={data.overview.reports} description="counted reports received">
        <SummaryStats items={[{ label: 'Cleanups', value: data.overview.cleanups }, { label: 'Joined', value: data.overview.joined }, { label: 'Need help', value: data.overview.needHelp }]} />
      </SummaryCard>
      <p className="eyebrow" style={{ margin: '2px 0 -4px' }}>Beach updates</p>
      {changed.length ? changed.slice(0, 8).map(beach => <WhiteCard key={beach.id} className="update-card">
        <button className="coastal-link-row" onClick={() => nav('/insights/trends/' + beach.id)}>
          {thumbnail(beach)}<span className="grow"><strong>{beach.name}</strong>{bands(beach)}<small>Compared with {formatDate(data.comparisonAt)}</small></span><span>›</span>
        </button>
      </WhiteCard>) : <DataUnavailable title="No comparable changes yet">Two report windows with at least 3 active reports are needed to compare a beach’s attention levels.</DataUnavailable>}
      {changed.length > 0 && mapCredit}
      <p className="eyebrow" style={{ margin: '2px 0 -4px' }}>Explore insights</p>
      <div className="action-grid five">
        <ActionTile title="Trends" subtitle="Attention changes" icon={<BarChart size={19} />} onClick={() => nav('/insights/trends')} />
        <ActionTile title="Cleanup" subtitle="Results" icon={<Check color={C.navy} />} onClick={() => nav('/insights/cleanup')} />
        <ActionTile title="Participation" subtitle="Who joined" icon={<CommunityIcon size={19} />} onClick={() => nav('/insights/participation')} />
        <ActionTile title="Wildlife" subtitle="Reference context" icon={<SpeciesIcon glyph="grass" size={20} />} onClick={() => nav('/insights/wildlife')} />
        <ActionTile title="Volunteers" subtitle="Beaches needing help" icon={<CommunityIcon size={19} />} onClick={() => nav('/community/needs-volunteers')} />
      </div>
    </>;
  } else if (topic === 'trends' && beachId) {
    const beach = data.beaches.find(b => b.id === beachId);
    const maxReports = Math.max(1, ...(beach?.monthlyReports.map(m => m.count) ?? [1]));
    body = beach ? <>
      <SummaryCard eyebrow={beach.area} description={beach.name} />
      <WhiteCard>
        <p className="eyebrow">Attention · compared with 30 days ago</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted }}><span>{formatDate(data.comparisonAt)}</span><span>{formatDate(data.asOf)}</span></div>
        <div className="update-bands" style={{ margin: '14px 0' }}>{bands(beach)}</div>
        <p className="subtle">{beach.reportsLast30Days} counted reports received in the last 30 days · {beach.reportsPrevious30Days} in the previous 30 days.</p>
        <p className="coastal-footnote">Each attention level uses the median of active report scores in its latest 90 days. Fewer than 3 active reports means Insufficient Data.</p>
        <p className="coastal-footnote">{data.comparisonBasis}</p>
      </WhiteCard>
      <WhiteCard>
        <p className="eyebrow">Reports received in the last 12 calendar months</p>
        <p className="subtle">{beach.monthlyReports[0]?.month} – {beach.monthlyReports[beach.monthlyReports.length - 1]?.month} · current month to date</p>
        <div className="coastal-bars" role="img" aria-label={'Monthly counted reports: ' + beach.monthlyReports.map(m => `${m.month}: ${m.count}`).join(', ')}>
          {beach.monthlyReports.map(month => <div key={month.month}><small>{month.count}</small><i style={{ height: month.count / maxReports * 110 }} /><small>{month.label.slice(0, 1)}</small></div>)}
        </div><p className="coastal-footnote">Counts reports, not litter items.</p>
      </WhiteCard>
      <WhiteCard><p className="eyebrow">Current litter by category</p>
        {beach.composition.length ? <MetricBars rows={beach.composition} /> : <p className="subtle">No active litter reports in this window.</p>}
        {beach.composition.length > 0 && <p className="subtle">Largest share of weighted reported composition: {beach.composition[0][0]} ({beach.composition[0][1]}%).</p>}
        <p className="coastal-footnote">Weighted share of reported amounts from {beach.activeReports} active reports in the last 90 days.</p>
      </WhiteCard>
      <PrimaryButton onClick={() => nav('/community?beach=' + beach.id)}>Find a Cleanup Here</PrimaryButton>
      <GhostButton onClick={() => nav('/beach/' + beach.id)}>Open Beach Page</GhostButton>
    </> : <DataUnavailable title="Beach trend not found" />;
  } else if (topic === 'trends') {
    const region = params.get('region') ?? '';
    const band = params.get('band') ?? '';
    const needs = params.get('needs') === '1';
    const search = params.get('q') ?? '';
    const rows = data.beaches.filter(b => (!region || b.area.includes(region)) && (!band || (b.to ? severityLabel(b.to) : 'Insufficient Data') === band)
      && (!needs || b.needsHelp) && b.name.toLowerCase().includes(search.toLowerCase()));
    body = <>
      <SummaryCard eyebrow={`30-day comparison · ${data.overview.registeredBeaches} beaches`} value={data.trendSummary.changed} description="beaches changed attention level">
        <SummaryStats items={[{ label: 'Moved up', value: data.trendSummary.movedUp }, { label: 'Moved down', value: data.trendSummary.movedDown }, { label: 'Not yet rated', value: data.trendSummary.noBand }]} />
      </SummaryCard>
      <p className="coastal-footnote">{data.trendSummary.comparable} beaches have comparable attention levels in both windows. {data.comparisonBasis}</p>
      <div className="search-row"><label className="coastal-search"><Search /><input aria-label="Search Beaches" placeholder="Search Beaches" value={search} onChange={e => update('q', e.target.value)} /></label>
        <button className="icon-button" aria-label="Filters" onClick={() => setFilters(true)}><BarChart size={19} /></button>
      </div>
      <p className="eyebrow">{rows.length} matching beaches · 90-day report windows</p>
      {rows.length ? <WhiteCard>{rows.map(beach => <LinkRow key={beach.id} title={beach.name} subtitle={beach.to ? `${severityLabel(beach.to)} · ${beach.activeReports} active reports` : `${beach.area} · ${beach.activeReports} active reports`}
        leading={thumbnail(beach)} trailing={<SeverityBadge band={beach.to} />} onClick={() => nav('/insights/trends/' + beach.id)} />)}</WhiteCard>
        : <DataUnavailable title="No matching beaches">No beach matches these filters.</DataUnavailable>}
      {rows.length > 0 && mapCredit}
      <GhostButton onClick={() => nav('/map')}>See All on the Map</GhostButton>
    </>;
  } else if (topic === 'participation') {
    const selected = params.get('beach') ?? 'all';
    const values = data.participation[selected] ?? data.participation.all ?? [0, 0, 0];
    const displayValues = values.map(value => typeof value === 'number' && value < 3 ? 'Fewer than 3' : value);
    const numericValues = values.filter((value): value is number => typeof value === 'number');
    const max = Math.max(1, ...numericValues);
    body = <>
      <label className="eyebrow" htmlFor="insight-participation-beach">Beach</label>
      <select id="insight-participation-beach" className="coastal-input" value={selected} onChange={e => update('beach', e.target.value === 'all' ? '' : e.target.value)}>
        <option value="all">All {data.overview.registeredBeaches} Beaches</option>{data.beaches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <SummaryCard eyebrow="Participation records · last 90 days">
        {['Joined', 'Recorded attendance', 'At a recorded cleanup'].map((label, index) => <div className="metric-bar" key={label}>
            <div><span>{label}</span><strong style={{ color: C.lime }}>{displayValues[index]}</strong></div>
          <div className="metric-track" style={{ background: '#ffffff1a' }}><i style={{ background: C.lime, width: typeof values[index] === 'number' ? values[index] / max * 100 + '%' : '0%' }} /></div>
        </div>)}
        <p className="coastal-footnote" style={{ color: '#ffffffb3' }}>{data.participationBasis}</p>
      </SummaryCard>
      {!values.some(Boolean) && <DataUnavailable title="No participation records yet">Joining, attendance and event-linked cleanup actions will appear here.</DataUnavailable>}
      <GhostButton onClick={() => nav('/community')}>Find a Cleanup</GhostButton>
    </>;
  } else if (topic === 'cleanup') {
    const latest = data.cleanup.history[0];
    const beachOptions = [...new Map([...data.beaches, ...catalogue].map(beach => [beach.id, beach])).values()];
    body = <>
      <label className="eyebrow" htmlFor="cleanup-insight-beach">Beach</label>
      <select id="cleanup-insight-beach" className="coastal-input" value={cleanupBeach ?? ''} onChange={e => update('beach', e.target.value)}>
        <option value="">All beaches</option>{beachOptions.map(beach => <option key={beach.id} value={beach.id}>{beach.name}</option>)}
      </select>
      {latest ? <>
      <SummaryCard eyebrow={`Latest cleanup · ${formatDate(latest.createdAt)}`} description={latest.beachName}>
        <h2 style={{ color: 'white' }}>Cleanup Recorded</h2><SummaryStats items={[{ label: 'Cleanup records · last 90 days', value: data.cleanup.total }, { label: 'Linked report updates', value: data.cleanup.evaluatedCleanups }]} />
      </SummaryCard>
      <p className="coastal-footnote">Active reports · latest 90 days: {data.beaches.reduce((sum, beach) => sum + beach.activeReports, 0)}. Counted report submissions received · last 90 days: {data.overview.reports}. Resolved reports remain in submission history but not the active rating count.</p>
      <WhiteCard><p className="eyebrow">Litter still above Small after cleanup</p>
        {data.cleanup.remaining.length ? data.cleanup.remaining.map(([category, percentage, samples]) => <div key={category}><MetricBars rows={[[category, percentage]]} /><p className="coastal-footnote">{samples} linked cleanup {samples === 1 ? 'record' : 'records'} with this category above Small before cleaning.</p></div>)
          : <p className="subtle">No linked before-and-after amount records yet.</p>}
        <p className="coastal-footnote">The percentage is based on linked cleanup records, not litter-item counts. Recorded amounts are volunteer estimates, not measured item counts or cleaning difficulty.</p>
      </WhiteCard>
      <WhiteCard><p className="eyebrow">How litter was handled</p><MetricBars rows={data.cleanup.handling} /><p className="coastal-footnote">Share of cleanup records, as recorded by participants.</p></WhiteCard>
      <WhiteCard><p className="eyebrow">Days until the next counted report</p>
        {data.cleanup.history.slice(0, 5).map(cleanup => <LinkRow key={cleanup.id} title={cleanup.beachName}
          subtitle={`Cleaned ${formatDate(cleanup.createdAt)} · ${cleanup.nextReportedAt ? nextReportPhrase(cleanup.daysUntilNextReport) : `${cleanup.followUpStatus ?? 'No follow-up report yet'} · ${dayCount(cleanup.daysSinceCleanup)} since cleanup`}`}
          onClick={() => nav('/insights/cleanup-history?cleanup=' + cleanup.id)} />)}
        <p className="coastal-footnote">Time to the next report anywhere at this beach. A later report does not establish that litter returned at the cleaned spot.</p>
      </WhiteCard><GhostButton onClick={() => nav('/insights/cleanup-history')}>View Cleanup History</GhostButton>
      </> : <DataUnavailable title="No cleanups recorded yet">Recorded cleanups from the last 90 days will appear here.</DataUnavailable>}
    </>;
  } else if (topic === 'cleanup-history') {
    const selected = params.get('cleanup');
    const cleanups = selected ? data.cleanup.history.filter(c => c.id === selected) : data.cleanup.history;
    body = cleanups.length ? <>
      {cleanups.map(cleanup => <section key={cleanup.id} style={{ display: 'grid', gap: 12 }}>
        <SummaryCard eyebrow={`Cleanup · ${formatDate(cleanup.createdAt)}`} description={cleanup.beachName}><h2 style={{ color: 'white' }}>Cleanup Recorded</h2></SummaryCard>
        {cleanupRows(cleanup)}<GhostButton onClick={() => nav('/beach/' + cleanup.beachId)}>View Beach</GhostButton>
      </section>)}
      {selected && <GhostButton onClick={() => nav('/insights/cleanup-history')}>All Cleanup History</GhostButton>}
    </> : <DataUnavailable title={selected ? 'Cleanup not in this window' : 'No cleanup history yet'}>This history includes recorded cleanup actions from the last 90 days.</DataUnavailable>;
  } else {
    body = <WildlifeCoverage beaches={data.wildlife} />;
  }
  return <CoastalPage title={title} className={!topic ? 'insights-hub' : ''} eyebrow={data ? `Saved records · as of ${formatDate(data.asOf)}` : 'Insights'}
    back={beachId ? '/beach/' + beachId : topic ? '/insights' : undefined}
    action={<div className="insights-header-actions">
      {!topic && personalAction}
      <button onClick={() => nav('/method')} className={topic ? '' : 'icon-button navy'} aria-label="About data">{topic ? 'About Data' : <Info color="white" size={22} />}</button>
    </div>}>
    {topic && topic !== 'wildlife' && chips}{body}
    {!loading && !error && data && <p className="coastal-footnote">Calculated from saved reports and cleanup records · {formatDate(data.asOf)}. No reports means unchecked, not clean.</p>}
    {filters && data && <Sheet title="Filters" onClose={() => setFilters(false)}>
      <button onClick={() => setParams(previous => { const next = new URLSearchParams(previous); ['region', 'band', 'needs'].forEach(k => next.delete(k)); return next; }, { replace: true })} style={{ color: C.navy }}>Reset</button>
      <p className="eyebrow" style={{ marginTop: 20 }}>State / area</p><div className="filter-chips">
        {[...new Set(data.beaches.map(b => b.area.split(',').slice(-1)[0]?.trim() ?? b.area))].sort().map(region => <button key={region} aria-pressed={params.get('region') === region} onClick={() => update('region', params.get('region') === region ? '' : region)}>{region}</button>)}
      </div><p className="eyebrow">Attention</p><div className="filter-chips">
        {['Severe', 'High', 'Moderate', 'Low', 'Insufficient Data'].map(band => <button key={band} aria-pressed={params.get('band') === band} onClick={() => update('band', params.get('band') === band ? '' : band)}>{band}</button>)}
      </div><label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>Needs Volunteers Only<input type="checkbox" checked={params.get('needs') === '1'} onChange={e => update('needs', e.target.checked ? '1' : '')} /></label>
      <PrimaryButton onClick={() => setFilters(false)}>Show Results</PrimaryButton>
    </Sheet>}
  </CoastalPage>;
}

function PreviewInsightsScreen({ personalAction }: { personalAction: ReactNode }) {
  const { topic = "", beachId } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(false);
  const state = params.get("region") ?? "";
  const band = params.get("band") ?? "";
  const needOnly = params.get("needs") === "1";
  const search = params.get("q") ?? "";
  const updateFilters = (values: Record<string, string>) => setParams(previous => {
    const next = new URLSearchParams(previous);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    return next;
  }, { replace: true });
  const setState = (value: string) => updateFilters({ region: value });
  const setBand = (value: string) => updateFilters({ band: value });
  const setNeedOnly = (value: boolean) => updateFilters({ needs: value ? "1" : "" });
  const setSearch = (value: string) => updateFilters({ q: value });
  const dataState = USE_MOCK ? params.get("state") : null;
  const titles: Record<string, string> = {
    trends: beachId ? "Beach Trend" : "Beach Trends",
    cleanup: beachId ? "Cleanup History" : "Cleanup Results",
    participation: "Participation",
    wildlife: "Wildlife Nearby",
  };
  const active =
    topic === "participation"
      ? "participation"
      : topic === "cleanup" || topic === "cleanup-history"
        ? "cleanup"
        : "trends";
  const chips = (
    <div className="coastal-segments" aria-label="Insight topics">
      {["trends", "cleanup", "participation"].map((t) => (
        <button
          key={t}
          aria-pressed={active === t}
          onClick={() => nav("/insights/" + t)}
        >
          {t === "trends"
            ? "Trends"
            : t === "cleanup"
              ? "Cleanup"
              : "Participation"}
        </button>
      ))}
    </div>
  );
  const about = (
    <button
      onClick={() => nav("/method")}
      className={topic ? "" : "icon-button navy"}
      aria-label="About data"
    >
      {topic ? "About Data" : <Info color="white" size={22} />}
    </button>
  );
  const demo = (
    <p className="demo-label">
      Preview · example data from the design · as of {preview.asOf}
    </p>
  );
  let body: ReactNode;
  if (dataState === "loading")
    body = (
      <>
        <Skeleton h={215} r={22} />
        <Skeleton h={110} r={22} />
        <Skeleton h={110} r={22} />
      </>
    );
  else if (dataState === "error")
    body = (
      <DataUnavailable
        title="Insights could not load"
        retry={() => setParams({})}
      >
        Please try again in a moment.
      </DataUnavailable>
    );
  else if (!USE_MOCK)
    body = (
      <DataUnavailable title="Insights are not available yet">
        Your reports and cleanups are still available from your account. This
        summary will appear when enough information is available.
      </DataUnavailable>
    );
  else if (!topic)
    body = (
      <>
        <SummaryCard
          eyebrow="Last 90 days · 4 pilot beaches"
          value={preview.reports}
          description="counted reports shape the beach ratings"
        >
          <SummaryStats
            items={[
              { label: "Cleanups", value: preview.cleanups },
              { label: "Joined", value: preview.joined },
              { label: "Need help", value: preview.needHelp },
            ]}
          />
        </SummaryCard>
        <p className="eyebrow" style={{ margin: "2px 0 -4px" }}>
          Beach updates
        </p>
        {preview.beaches
          .filter((b) => b.from && b.from !== b.to)
          .map((b) => (
            <WhiteCard key={b.id} className="update-card">
              <button
                className="coastal-link-row"
                onClick={() =>
                  nav(
                    b.id === "bagan"
                      ? "/insights/trends/bagan"
                      : "/insights/trends",
                  )
                }
              >
                <span className="row-thumb">
                  {b.photo ? (
                    <img src={b.photo} alt="" />
                  ) : (
                    <SpeciesIcon glyph="grass" size={28} />
                  )}
                </span>
                <span className="grow">
                  <strong>{b.name}</strong>
                  <span className="update-bands">
                    <SeverityBadge band={b.from} />
                    <span>→</span>
                    <SeverityBadge band={b.to} />
                  </span>
                  <small>Last 30 days · counted reports</small>
                </span>
                <span>›</span>
              </button>
            </WhiteCard>
          ))}
        <p className="eyebrow" style={{ margin: "2px 0 -4px" }}>
          Explore insights
        </p>
        <div className="action-grid five">
          <ActionTile
            title="Trends"
            subtitle="Attention changes"
            icon={<BarChart size={19} />}
            onClick={() => nav("/insights/trends")}
          />
          <ActionTile
            title="Cleanup"
            subtitle="Results"
            icon={<Check color={C.navy} />}
            onClick={() => nav("/insights/cleanup")}
          />
          <ActionTile
            title="Participation"
            subtitle="Who joined"
            icon={<CommunityIcon size={19} />}
            onClick={() => nav("/insights/participation")}
          />
          <ActionTile
            title="Wildlife"
            subtitle="Species nearby"
            icon={<SpeciesIcon glyph="grass" size={20} />}
            onClick={() => nav("/insights/wildlife")}
          />
          <ActionTile
            title="Volunteers"
            subtitle="Beaches needing help"
            icon={<CommunityIcon size={19} />}
            onClick={() => nav("/community/needs-volunteers")}
          />
        </div>
        {demo}
      </>
    );
  else if (topic === "trends" && beachId) {
    const b = preview.beaches.find((x) => x.id === beachId);
    body = b ? (
      <>
        <SummaryCard eyebrow={b.area} description={b.name} />
        <WhiteCard>
          <p className="eyebrow">Attention · 30-day change</p>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: C.muted,
            }}
          >
            <span>28-08-2026</span>
            <span>27-09-2026</span>
          </div>
          <div className="update-bands" style={{ margin: "14px 0" }}>
            <SeverityBadge band={b.from} />
            <span>→</span>
            <SeverityBadge band={b.to} />
          </div>
          <p className="subtle">
            {b.id === "bagan"
              ? "Up from Moderate. 4 counted reports in the last 30 days, up from 2."
              : "An attention level describes the reports received, not a verified condition of the whole beach."}
          </p>
        </WhiteCard>
        {b.id === "bagan" && (
          <>
            <WhiteCard>
              <p className="eyebrow">Reports received in the last 12 months</p>
              <p className="subtle">Oct 2025 – Sep 2026</p>
              <div
                className="coastal-bars"
                role="img"
                aria-label={
                  "Monthly counted reports: " +
                  preview.monthlyReports.join(", ")
                }
              >
                {preview.monthlyReports.map((n, i) => (
                  <div key={i}>
                    <small>{n}</small>
                    <i style={{ height: n * 22 }} />
                    <small>{"ONDJFMAMJJAS"[i]}</small>
                  </div>
                ))}
              </div>
              <p className="coastal-footnote">
                Counts reports, not litter items.
              </p>
            </WhiteCard>
            <WhiteCard>
              <p className="eyebrow">Reported litter by category</p>
              <MetricBars rows={preview.composition} />
              <p className="coastal-footnote">
                Share of reported amount, counted reports only.
              </p>
            </WhiteCard>
            <SummaryCard
              eyebrow="Litter recurrence"
              value="9 days"
              description="until the next counted report"
            >
              <SummaryStats
                items={[
                  { label: "Cleaned", value: "15-08-2026" },
                  { label: "Next counted report", value: "24-08-2026" },
                ]}
              />
            </SummaryCard>
          </>
        )}
        <PrimaryButton onClick={() => nav("/community?beach=" + b.id)}>
          Find a Cleanup Here
        </PrimaryButton>
        <GhostButton onClick={() => nav("/beach/" + b.id)}>
          Open Beach Page
        </GhostButton>
        {demo}
      </>
    ) : (
      <DataUnavailable title="Beach trend not found" />
    );
  } else if (topic === "trends") {
    const rows = preview.beaches.filter(
      (b) =>
        (!state || b.area.includes(state)) &&
        (!band ||
          (b.to ? severityLabel(b.to) : "Insufficient Data") === band) &&
        (!needOnly || preview.volunteerBeachIds.includes(b.id)) &&
        b.name.toLowerCase().includes(search.toLowerCase()),
    );
    body = (
      <>
        <SummaryCard
          eyebrow="30-day change · 4 pilot beaches"
          value="2"
          description="beaches changed attention level"
        >
          <SummaryStats
            items={[
              { label: "Moved up", value: 1 },
              { label: "Moved down", value: 1 },
              { label: "Not yet rated", value: 1 },
            ]}
          />
        </SummaryCard>
        <div className="search-row">
          <label className="coastal-search">
            <Search />
            <input
              aria-label="Search Beaches"
              placeholder="Search Beaches"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            className="icon-button"
            aria-label="Filters"
            onClick={() => setFilters(true)}
          >
            <BarChart size={19} />
          </button>
        </div>
        <p className="eyebrow">4 pilot beaches · 30-day trend</p>
        {rows.length ? (
          <WhiteCard>
            {rows.map((b) => (
              <LinkRow
                key={b.id}
                title={b.name}
                subtitle={
                  b.to
                    ? b.from === b.to
                      ? severityLabel(b.to) + " · no change in 30 days"
                      : severityLabel(b.to) + " · from " + b.from
                    : "Selangor · 0 counted reports"
                }
                leading={
                  <span className="row-thumb">
                    {b.photo ? (
                      <img alt="" src={b.photo} />
                    ) : (
                      <SpeciesIcon glyph="grass" />
                    )}
                  </span>
                }
                trailing={<SeverityBadge band={b.to} />}
                onClick={() =>
                  nav(
                    b.id === "bagan"
                      ? "/insights/trends/bagan"
                      : "/beach/" + b.id,
                  )
                }
              />
            ))}
          </WhiteCard>
        ) : (
          <DataUnavailable title="No matching beaches">
            No beach matches these filters.
          </DataUnavailable>
        )}
        <GhostButton onClick={() => nav("/map")}>
          See All on the Map
        </GhostButton>
        {dataState === "insufficient" && (
          <DataUnavailable title="More reports needed">
            At least 3 counted reports are needed to calculate a litter rating.
          </DataUnavailable>
        )}
        {demo}
      </>
    );
  } else if (topic === "participation") {
    const selection = params.get("beach") ?? "all";
    const values =
      preview.participation[selection] ?? preview.participation.all;
    body = (
      <>
        <div className="filter-chips" style={{ margin: 0 }}>
          {[
            ["all", "All 4 Beaches"],
            ["morib", "Morib"],
            ["bagan", "Bagan Lalang"],
          ].map(([id, name]) => (
            <button
              key={id}
              aria-pressed={selection === id}
              onClick={() => setParams(id === "all" ? {} : { beach: id })}
            >
              {name}
            </button>
          ))}
        </div>
        <SummaryCard eyebrow="Joining to cleanup · last 90 days">
          {["Joined", "Recorded attendance", "At a recorded cleanup"].map(
            (name, i) => (
              <div className="metric-bar" key={name}>
                <div>
                  <span>{name}</span>
                  <strong style={{ color: C.lime }}>
                    {values[i]}
                    {i > 0
                      ? " · " +
                        Math.round((values[i] / values[i - 1]) * 100) +
                        "%"
                      : ""}
                  </strong>
                </div>
                <div
                  className="metric-track"
                  style={{ background: "#ffffff1a" }}
                >
                  <i
                    style={{
                      background: C.lime,
                      width: (values[i] / values[0]) * 100 + "%",
                    }}
                  />
                </div>
              </div>
            ),
          )}
          <p className="coastal-footnote" style={{ color: "#ffffffb3" }}>
            {selection === "all"
              ? "All 4 pilot beaches"
              : preview.beaches.find((b) => b.id === selection)?.name}{" "}
            · anonymous totals. Each percentage compares a step with the one
            above.
          </p>
        </SummaryCard>
        <GhostButton onClick={() => nav("/community")}>
          Find a Cleanup
        </GhostButton>
        {demo}
      </>
    );
  } else if (topic === "cleanup")
    body =
      dataState === "insufficient" ? (
        <DataUnavailable title="Too few cleanups yet">
          More recorded cleanups are needed to show a pattern.
        </DataUnavailable>
      ) : (
        <>
          <SummaryCard
            eyebrow="Latest cleanup · 19-09-2026 (Sat)"
            description="Pantai Morib"
          >
            <h2 style={{ color: "white" }}>Cleanup Recorded</h2>
            <SummaryStats
              items={[
                { label: "Cleanups in 90 days", value: 8 },
                { label: "Most left", value: "Fishing gear" },
              ]}
            />
          </SummaryCard>
          <WhiteCard>
            <p className="eyebrow">Hardest to clear · 8 cleanups</p>
            <MetricBars rows={preview.remaining} />
            <p className="coastal-footnote">
              Of cleanups with this litter, the share that still had more than
              Small left.
            </p>
          </WhiteCard>
          <WhiteCard>
            <p className="eyebrow">How litter was handled</p>
            <MetricBars rows={preview.handling} />
            <p className="coastal-footnote">As recorded by participants.</p>
          </WhiteCard>
          <WhiteCard>
            <p className="eyebrow">Days until next counted report</p>
            <LinkRow
              title="Pantai Bagan Lalang"
              subtitle="Cleaned 15-08-2026 · 9 days"
              onClick={() => nav("/insights/trends/bagan")}
            />
            <LinkRow
              title="Pantai Morib"
              subtitle="No follow-up report yet · 8 days since cleanup"
              onClick={() => nav("/beach/morib")}
            />
          </WhiteCard>
          <GhostButton onClick={() => nav("/insights/cleanup-history")}>
            View Cleanup History
          </GhostButton>
          {demo}
        </>
      );
  else if (topic === "cleanup-history")
    body = (
      <>
        <SummaryCard
          eyebrow="Cleanup history · 19-09-2026 (Sat)"
          description="Teluk Cempedak"
        >
          <h2 style={{ color: "white" }}>Cleanup Recorded</h2>
        </SummaryCard>
        <WhiteCard>
          <p className="eyebrow">Recorded change</p>
          {[
            ["Plastic", "Very Large → Small"],
            ["Fishing gear", "Large → Small"],
            ["Paper", "Large → Small"],
            ["Glass", "Medium → Small"],
          ].map(([c, b]) => (
            <div className="coastal-link-row" key={c}>
              <strong className="grow">{c}</strong>
              <small>{b}</small>
            </div>
          ))}
        </WhiteCard>
        <GhostButton onClick={() => nav("/beach/teluk-cempedak")}>View Beach</GhostButton>
        {demo}
      </>
    );
  else
    body = (
      <>
        <SummaryCard
          eyebrow="Design preview · OBIS modelled"
          value={2}
          description="species and 3 habitats across the 4 pilot beaches"
        />
        {preview.wildlife.map(item => <button className="wildlife-beach-card" key={item.beachId} onClick={() => nav("/beach/" + item.beachId)}>
          <span><strong>{preview.beaches.find(b => b.id === item.beachId)!.name}</strong><small>{item.habitat}</small></span>
          <span className="wildlife-species">{item.species.map(name => <span key={name}>{name}</span>)}</span>
        </button>)}
        <p className="coastal-footnote">Design preview · OBIS snapshot 09-2026. These are not confirmed sightings.</p>
      </>
    );
  return (
    <CoastalPage
      title={
        titles[topic] ??
        (topic === "cleanup-history" ? "Cleanup History" : "Insights")
      }
      className={!topic ? "insights-hub" : ""}
      eyebrow={
        topic === "wildlife" ? "OBIS · snapshot 09-2026" : USE_MOCK
          ? (topic ? "Insights · as of " : "4 pilot beaches · as of ") +
            preview.asOf
          : undefined
      }
      back={beachId ? "/insights/" + topic : topic ? "/insights" : undefined}
      action={<div className="insights-header-actions">
        {!topic && personalAction}
        {topic === "wildlife" ? <button onClick={() => nav("/marine-life")}>Marine Life</button> : about}
      </div>}
      subtitle={topic === "wildlife" ? "Modelled species and habitats, not sightings." : undefined}
    >
      {topic && topic !== "wildlife" && chips}
      {body}
      {filters && (
        <Sheet title="Filters" onClose={() => setFilters(false)}>
          <button
            onClick={() => {
              updateFilters({ region: "", band: "", needs: "" });
            }}
            style={{ color: C.navy }}
          >
            Reset
          </button>
          <p className="eyebrow" style={{ marginTop: 20 }}>
            State
          </p>
          <div className="filter-chips">
            {["Selangor", "Negeri Sembilan", "Penang", "Johor", "Sabah"].map(
              (s) => (
                <button
                  key={s}
                  aria-pressed={state === s}
                  onClick={() => setState(state === s ? "" : s)}
                >
                  {s}
                </button>
              ),
            )}
          </div>
          <p className="eyebrow">Attention</p>
          <div className="filter-chips">
            {["Severe", "High", "Moderate", "Low", "Insufficient Data"].map(
              (s) => (
                <button
                  key={s}
                  aria-pressed={band === s}
                  onClick={() => setBand(band === s ? "" : s)}
                >
                  {s}
                </button>
              ),
            )}
          </div>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 20,
            }}
          >
            Needs Volunteers Only
            <input
              type="checkbox"
              checked={needOnly}
              onChange={(e) => setNeedOnly(e.target.checked)}
            />
          </label>
          <PrimaryButton onClick={() => setFilters(false)}>
            Show Results
          </PrimaryButton>
        </Sheet>
      )}
    </CoastalPage>
  );
}
