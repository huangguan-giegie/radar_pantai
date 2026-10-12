// Pure report-flow rules shared by the report screens.
import type { ReportDraft } from './AppContext';
import type {
  CreateReportInput,
  LitterCategory,
  LitterReport,
  QuantityBand,
  QuantityByCategory,
  ReportStatus,
} from './types';

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/home';
  return value;
}

export type ReportStep = 'photo' | 'location' | 'confirm' | 'suggestions' | 'details' | 'review';

// Recognition precedes manual confirmation for every new photo.
const STEP_ORDER: ReportStep[] = ['photo', 'location', 'confirm', 'suggestions', 'details', 'review'];
const STEP_PATH: Record<ReportStep, string> = {
  photo: '/report/photo',
  location: '/report/location',
  confirm: '/report/confirm',
  suggestions: '/report/suggestions',
  details: '/report/details',
  review: '/report/review',
};

export function hasDraftProgress(draft: ReportDraft): boolean {
  return Boolean(
    draft.photo
    || draft.existingPhotoUrl
    || draft.existingPhotoKey
    || draft.beachId
    || draft.editingReportId
    || Object.keys(draft.quantities).length > 0,
  );
}

/** Legacy-only helper: detector counts may still be converted to a suggestion band. */
export function quantityBandForCount(count: number): QuantityBand {
  if (count <= 5) return 'Small';
  if (count <= 20) return 'Medium';
  if (count <= 50) return 'Large';
  return 'Very Large';
}

/** Legacy/internal adapter. New participant-facing state is already band-based. */
export function quantityBandsForCounts(
  counts: Partial<Record<LitterCategory, number>>,
): QuantityByCategory {
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, count]) => Number.isInteger(count) && Number(count) > 0)
      .map(([category, count]) => [category, quantityBandForCount(Number(count))]),
  ) as QuantityByCategory;
}

export function historicalPhotoUnavailable(
  photoUrl: string | null | undefined,
  photoKey: string | null | undefined,
): boolean {
  return Boolean(photoKey && !photoUrl);
}

const REPORT_CATEGORY_ORDER: LitterCategory[] = ['Plastic', 'Fishing gear', 'Glass', 'Metal', 'Paper', 'Other'];

/** User-facing report summaries always show the confirmed band, never a legacy exact count. */
export function formatReportComposition(
  quantities: QuantityByCategory,
  _legacyItemCounts?: Partial<Record<LitterCategory, number>>,
): string {
  const items = REPORT_CATEGORY_ORDER
    .filter((category) => quantities[category])
    .map((category) => `${category} — ${quantities[category]}`);
  return items.length > 0 ? items.join(' · ') : 'No categories recorded';
}

function validBandState(quantities: QuantityByCategory): boolean {
  const picked = Object.keys(quantities) as LitterCategory[];
  return picked.length > 0 && picked.every((category) => Boolean(quantities[category]));
}

/** The furthest report step justified by the current draft. */
export function reachableStep(draft: ReportDraft): ReportStep {
  const hasPhoto = Boolean(draft.photo || draft.existingPhotoUrl || draft.existingPhotoKey);
  if (!hasPhoto) return 'photo';
  if (!draft.beachId) return 'confirm';

  // Historical corrections keep their existing photo and enter the editable
  // details form. Recognition is only required for a new photo or an explicit
  // retry/replacement.
  if (draft.editingReportId && !draft.photo && !draft.aiDecision) return 'details';

  // Recognition runs before the participant-facing category and band form.
  // Undefined is the shape of pre-AI drafts restored from older builds. A
  // previously decided draft can still be resumed; a fresh null state must
  // visit recognition first.
  if (draft.aiModelState == null && !draft.aiDecision) return 'suggestions';

  // Empty, unavailable and timed-out recognition results always have a
  // manual route. Do not send the participant back to recognition forever.
  if (draft.aiModelState && !draft.aiDecision) return 'details';

  if (!validBandState(draft.quantities)) return 'details';

  // The user must explicitly accept the AI suggestion or keep their own bands
  // before Review.
  if (!draft.aiDecision) return 'suggestions';
  return 'review';
}

export type DetailsContinue =
  | { to: '/report/suggestions' }
  | { to: '/report/review'; aiDecision: 'confirmed' | 'manual' };

/**
 * Where Continue on the details step goes.
 *
 * The AI check runs once per photo. aiModelState is null until it has run, and
 * a new photo resets it (AppContext.patchDraft), so a fresh photo is always
 * checked. Once it has run, Continue goes straight to Review and keeps any
 * decision already made: values kept as manual stay manual after an edit.
 * With no decision yet, bands the user reached from a ready suggestion count
 * as a confirmed suggestion, and anything else as manual.
 */
export function continueFromDetails(draft: ReportDraft): DetailsContinue {
  return {
    to: '/report/review',
    aiDecision: draft.aiDecision ?? 'manual',
  };
}

/** The backend's code for a report whose every category is Small (422). */
export const SMALL_ONLY_REPORT_CODE = 'SMALL_ONLY_REPORT';

/**
 * True when a failed save was the Small-only rule, not a fault. Small reports
 * are not recorded by design, so the review screen shows a calm outcome with
 * a way to change the band instead of a red "Could not save".
 */
export function isSmallOnlyRejection(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === SMALL_ONLY_REPORT_CODE,
  );
}

function malaysiaLocalDay(value: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

function normalizedQuantities(quantities: QuantityByCategory): string {
  return Object.entries(quantities)
    .filter((entry): entry is [LitterCategory, NonNullable<QuantityByCategory[LitterCategory]>] => Boolean(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, quantity]) => `${category}:${quantity}`)
    .join('|');
}

export function findExactDuplicateReport(
  draft: ReportDraft,
  reports: LitterReport[],
  now: Date = new Date(),
): LitterReport | null {
  if (!draft.beachId || Object.keys(draft.quantities).length === 0) return null;
  const today = malaysiaLocalDay(now);
  const signature = normalizedQuantities(draft.quantities);
  return reports.find((report) =>
    report.id !== draft.editingReportId
    && report.beachId === draft.beachId
    && malaysiaLocalDay(report.createdAt) === today
    && normalizedQuantities(report.quantities) === signature,
  ) ?? null;
}

export function guardStep(target: ReportStep, draft: ReportDraft): string | null {
  const furthest = reachableStep(draft);
  return STEP_ORDER.indexOf(target) <= STEP_ORDER.indexOf(furthest) ? null : STEP_PATH[furthest];
}

export function resumePath(draft: ReportDraft): string {
  return STEP_PATH[reachableStep(draft)];
}

export type ReportSubmission =
  | { kind: 'create'; payload: CreateReportInput }
  | { kind: 'update'; reportId: string; changes: Partial<CreateReportInput> };

/**
 * New writes use `quantities` as canonical state. A restored pre-migration draft
 * that has only legacy itemCounts may still be normalised so it is not lost.
 */
export function buildReportSubmission(draft: ReportDraft): ReportSubmission {
  if (!draft.aiDecision) {
    throw new Error('Confirm the AI suggestion or your manual values before submitting.');
  }

  const canonicalBandsPresent = Object.keys(draft.quantities).length > 0;
  const legacyCountOnly = !canonicalBandsPresent && Boolean(draft.itemCounts && Object.keys(draft.itemCounts).length > 0);
  const quantities = legacyCountOnly && draft.itemCounts
    ? quantityBandsForCounts(draft.itemCounts)
    : draft.quantities;

  const picked = Object.keys(quantities) as LitterCategory[];
  if (!draft.beachId || picked.length === 0) {
    throw new Error('This report is missing a required field. Go back and complete it.');
  }
  const noBand = picked.filter((category) => !quantities[category]);
  if (noBand.length > 0) {
    throw new Error(`Pick how much for: ${noBand.join(', ')}.`);
  }

  if (legacyCountOnly && draft.itemCounts) {
    const countCategories = Object.keys(draft.itemCounts).sort();
    if (
      countCategories.length !== picked.length
      || countCategories.some((category) => !picked.includes(category as LitterCategory))
      || Object.values(draft.itemCounts).some((count) => !Number.isInteger(count) || count! < 1 || count! > 100_000)
    ) {
      throw new Error('The legacy item counts no longer match the selected categories.');
    }
  }

  const usesGps = draft.locationSource === 'gps' && draft.coords !== null;
  const common = {
    beachId: draft.beachId,
    quantities,
    ...(draft.editingReportId && draft.locationSource === 'gps' && draft.coords === null
      ? {}
      : { locationSource: usesGps ? ('gps' as const) : ('manual' as const) }),
    ...(usesGps ? { coords: draft.coords! } : {}),
  };

  if (draft.editingReportId) {
    if (draft.photo && !draft.photo.metadataStripped) {
      throw new Error('The replacement photo still contains location metadata.');
    }
    return {
      kind: 'update',
      reportId: draft.editingReportId,
      changes: {
        ...common,
        ...(draft.photo
          ? { photoKey: draft.photo.photoKey }
          : draft.existingPhotoKey
            ? { photoKey: draft.existingPhotoKey }
            : {}),
      },
    };
  }

  if (!draft.photo) throw new Error('This report needs a photo. Go back and add one.');
  if (!draft.photo.metadataStripped) throw new Error('The photo still contains location metadata.');

  return {
    kind: 'create',
    payload: {
      ...common,
      photoKey: draft.photo.photoKey,
      locationSource: usesGps ? 'gps' : 'manual',
      ...(legacyCountOnly && draft.itemCounts ? { itemCounts: draft.itemCounts } : {}),
      ...(draft.eventId ? { eventId: draft.eventId } : {}),
      ...(usesGps ? { coords: draft.coords! } : {}),
    },
  };
}

export type ReportOutcome = {
  title: string;
  badge: string;
  message: string;
  tone: 'success' | 'neutral' | 'warning';
};

export function reportOutcome(status: ReportStatus): ReportOutcome {
  if (status === 'Counted') {
    return {
      title: "Nice one — it's on the map",
      badge: 'COUNTED',
      message: "Thanks for this. Your report passed the checks, so it now counts toward this beach's rating — that's one more piece of evidence for the coast.",
      tone: 'success',
    };
  }
  if (status === 'Duplicate') {
    return {
      title: 'Saved — but not counted',
      badge: 'DUPLICATE · EXCLUDED',
      message: 'This report matches existing evidence and is saved in your reports but excluded from the beach rating.',
      tone: 'neutral',
    };
  }
  return {
    title: 'Saved — correction needed',
    badge: 'INCOMPLETE · EXCLUDED',
    message: 'This report is saved in your reports but is excluded from the beach rating until the missing or unusable information is corrected.',
    tone: 'warning',
  };
}

export type BackFromReview = { pop: true } | { pop: false; to: string };
export const CAME_FROM_DETAILS = 'details';

export function backFromReview(state: { from?: string } | null | undefined): BackFromReview {
  return state?.from === CAME_FROM_DETAILS ? { pop: true } : { pop: false, to: '/report/details' };
}

type SavedRouteNavigate = (
  to: '/report/saved',
  options: { replace: true; flushSync: true },
) => void;

export function finishReportSubmission(navigate: SavedRouteNavigate) {
  navigate('/report/saved', { replace: true, flushSync: true });
}

export function orderByNeed<T extends {
  name: string;
  severity: unknown;
  insufficientData: boolean;
  validReports: number;
  attentionScore: number | null;
}>(beaches: T[]): T[] {
  const rated = (beach: T) => !beach.insufficientData && beach.severity !== null;
  return [...beaches].sort((left, right) => {
    if (rated(left) !== rated(right)) return rated(left) ? -1 : 1;
    if (rated(left)) {
      const diff = (right.attentionScore ?? 0) - (left.attentionScore ?? 0);
      if (diff !== 0) return diff;
    } else {
      const diff = right.validReports - left.validReports;
      if (diff !== 0) return diff;
    }
    return left.name.localeCompare(right.name);
  });
}
