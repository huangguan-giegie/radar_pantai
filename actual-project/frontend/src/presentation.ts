/** Labels from saved API responses can retain the previous product vocabulary. */
export function marineLifeCopy(value: string) {
  return value.replace(/wildlife/gi, match => match[0] === 'W' ? 'Marine Life' : 'marine life');
}

/** Apply title case to action labels, never species names or user-entered text. */
export function actionTitle(value: string) {
  const minor = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return marineLifeCopy(value).replace(/\b[A-Za-z][A-Za-z’']*/g, (word, index: number) => {
    // Preserve acronyms in control labels (AI, GPS, API, OBIS), not just title case.
    if (/^[A-Z]{2,}$/.test(word)) return word;
    return index > 0 && minor.has(word.toLowerCase())
      ? word.toLowerCase()
      : word[0].toUpperCase() + word.slice(1);
  });
}

export function cleanupInterval(facts: { intervalDays?: number | null; daysSinceCleanup?: number }) {
  const followed = typeof facts.intervalDays === 'number';
  const days = followed ? facts.intervalDays! : facts.daysSinceCleanup;
  return {
    value: followed && days === 0 ? 'Same Day' : days ?? '—',
    unit: followed && days === 0 ? '' : days === 1 ? 'DAY' : 'DAYS',
    description: followed ? 'From your cleanup to the next counted report' : 'Since your recorded cleanup',
    followed,
  };
}
