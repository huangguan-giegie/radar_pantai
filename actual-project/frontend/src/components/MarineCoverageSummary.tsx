import { SummaryCard } from './CoastalUI';

export function MarineCoverageSummary({ total, published, modelled, available }: {
  total: number; published: number; modelled: number; available: boolean;
}) {
  return <>
    <SummaryCard eyebrow="Coverage for Marine Life Nearby" value={total} description="beaches in total">
      {available && <div className="marine-coverage-stats" aria-label="Marine life evidence coverage">
        {[
          ['Published coastal references', published],
          ['Modelled marine-life context', modelled],
          ['No marine life data yet', total - published - modelled],
        ].map(([label, count]) => <div key={label}><strong>{count} <small>{count === 1 ? 'beach' : 'beaches'}</small></strong><span>{label}</span></div>)}
      </div>}
    </SummaryCard>
    <p className="coastal-footnote">These figures cover beaches listed in Radar Sampah, not all beaches in Malaysia. Published references and modelled context are different evidence types. Neither confirms a sighting at a beach.</p>
  </>;
}
