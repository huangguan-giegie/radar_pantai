import { SummaryCard } from './CoastalUI';

export function MarineCoverageSummary({ total, published, modelled, available }: {
  total: number; published: number; modelled: number; available: boolean;
}) {
  return <><SummaryCard eyebrow="Coverage for Marine Life Nearby" value={total} description="beaches in total">
    {available && <div className="marine-coverage-stats" aria-label="Marine life evidence coverage">
      <div><strong>{published} <small>{published === 1 ? 'beach' : 'beaches'}</small></strong><span>Curated coastal references</span></div>
      <div><strong>{modelled} <small>{modelled === 1 ? 'beach' : 'beaches'}</small></strong><span>OBIS-derived model context</span></div>
      <div><strong>{total - published - modelled} <small>{total - published - modelled === 1 ? 'beach' : 'beaches'}</small></strong><span>No marine life data yet</span></div>
    </div>}
  </SummaryCard>
    <p className="coastal-footnote">These figures cover beaches listed in Radar Sampah, not all beaches in Malaysia. Curated references and modelled context are different evidence types. Neither confirms a sighting at a beach.</p>
  </>;
}
