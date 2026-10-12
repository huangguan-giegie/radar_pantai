import type { PersonalInsights } from '../iteration3Personal';
import { actionTitle, cleanupInterval, marineLifeCopy } from '../presentation';
import { C, formatDate } from '../theme';
import { PHOTOS } from '../visuals';
import { BarChart, SpeciesIcon } from './Icon';
import { LinkRow, WhiteCard } from './CoastalUI';

export function PersonalInsightCard({ section, onNavigate }: {
  section: PersonalInsights['sections'][number]; onNavigate: (path: string) => void;
}) {
  const facts = section.facts;
  const interval = facts ? cleanupInterval(facts) : null;
  const litter = section.id === 'litter_wildlife';
  return <WhiteCard className="personal-insight-card">
    <header className="personal-card-header"><span className="personal-icon">{litter
      ? <SpeciesIcon glyph="turtle" size={18} color={C.lime} /> : <BarChart size={18} color={C.lime} />}</span>
      <p className="eyebrow">{marineLifeCopy(section.title)}</p></header>
    {section.aiAssisted && <p className="coastal-footnote">AI-assisted</p>}
    {litter && facts ? <>
      <div className="personal-litter-fact"><div><p className="subtle">Top category in your reports</p><strong>{facts.category}</strong>
        <small>{facts.reportCount} counted {facts.reportCount === 1 ? 'report' : 'reports'}</small></div><img src={PHOTOS.turtle} alt="Sea turtle · species example" /></div>
      <div className="personal-insight-risk"><p className="eyebrow">May affect</p><strong>{marineLifeCopy(facts.speciesGroups?.join(' · ') ?? '')}</strong><small>{facts.riskType}</small></div>
      <p className="coastal-footnote">General research · no local harm shown</p>
    </> : section.id === 'since_cleanup' && facts && interval ? <>
      <div className={'personal-cleanup-fact' + (interval.value === 'Same Day' ? ' is-same-day' : '')}>
        <div><strong>{interval.value}</strong>{interval.unit && <small>{interval.unit}</small>}</div>
        <div><b>{facts.beachName}</b><p className="subtle">{interval.description}</p></div>
      </div>
      {!interval.followed && <p className="coastal-footnote">{facts.followUpStatus ?? 'No follow-up report yet'}</p>}
      <p className="coastal-footnote">Community reporting, not measured litter return</p>
    </> : section.id === 'persistent_litter' && facts ? <>
      <p className="personal-insight-fact">{facts.category}</p><p className="subtle">{marineLifeCopy(section.text || `Remained above Small in ${facts.remainingCleanupCount} of ${facts.includedCleanupCount} eligible cleanups.`)}</p>
    </> : <p className="subtle">{marineLifeCopy(section.text)}</p>}
    {section.id !== 'since_cleanup' && section.sources.map(source => {
      // Personal totals include Counted reports that were later resolved; the
      // current Counted tab hides those, so own-report sources open all history.
      const sourcePath = litter && source.url.split('?')[0] === '/reports' ? '/reports' : source.url;
      return <p className="coastal-footnote personal-source" key={source.url}>
        {source.url.startsWith('/') ? <button onClick={() => onNavigate(sourcePath)}>{marineLifeCopy(source.label)}</button>
          : <a href={source.url} target="_blank" rel="noreferrer">{marineLifeCopy(source.label)}</a>}
        {section.reviewDate && ' · Reviewed ' + formatDate(section.reviewDate)}
      </p>;
    })}
    <LinkRow title={litter ? 'Review My Reports' : actionTitle(section.action.label)}
      onClick={() => onNavigate(litter ? '/reports' : section.action.path)} />
  </WhiteCard>;
}
