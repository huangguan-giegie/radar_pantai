import { SummaryCard } from './CoastalUI';

export function MarineCoverageSummary({ total, published, modelled, available }: {
  total: number; published: number; modelled: number; available: boolean;
}) {
  return <SummaryCard eyebrow="Marine Life Coverage · Curated References & OBIS Model" value={total} description="registered beaches">
    {available && <div className="marine-coverage-stats" aria-label="Marine life evidence coverage">
      <div><strong>{published} <small>{published === 1 ? 'beach' : 'beaches'}</small></strong><span>Curated coastal references</span></div>
      <div><strong>{modelled} <small>{modelled === 1 ? 'beach' : 'beaches'}</small></strong><span>OBIS-derived model context</span></div>
    </div>}
  </SummaryCard>;
}
