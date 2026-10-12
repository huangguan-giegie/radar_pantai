import type { RecurrenceEvidence as Evidence } from '../types';
import { WhiteCard } from './CoastalUI';

export function RecurrenceEvidence({ evidence, embedded = false }: { evidence?: Evidence | null; embedded?: boolean }) {
  if (!evidence) return null;
  // The API status is an evidence label, not human-friendly same-day grammar.
  const status = typeof evidence.intervalDays === 'number'
    ? evidence.intervalDays === 0 ? 'Next Counted report on the same day'
      : `${evidence.intervalDays} ${evidence.intervalDays === 1 ? 'day' : 'days'} until next Counted report`
    : evidence.status;
  const content = <>
      <p className="eyebrow">Litter Recurrence</p>
      <h3>{status}</h3>
      <p className="subtle">{evidence.daysSinceCleanup} {evidence.daysSinceCleanup === 1 ? 'day' : 'days'} since the recorded cleanup.</p>
      <p className="coastal-footnote">
        {evidence.intervalDays == null
          ? 'Recurrence is shown after a follow-up report is recorded.'
          : 'Time to the next counted beach report, not measured litter return.'}
      </p>
    </>;
  return embedded ? <div className="recurrence-inline">{content}</div> : <WhiteCard>{content}</WhiteCard>;
}
