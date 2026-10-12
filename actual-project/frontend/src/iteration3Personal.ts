export type NextAction = {
  id: string;
  actionLabel: string;
  reasonCode: string;
  reason: string;
  destination: { type: string; path: string; id?: string; beachId?: string };
  loginPrompt?: string;
  loginPath?: string;
};

export type PersonalInsights = {
  sections: {
    id: string;
    title: string;
    text: string;
    sources: { label: string; url: string }[];
    reviewDate?: string;
    action: { label: string; path: string };
    aiAssisted: boolean;
    facts?: {
      category?: string; reportCount?: number; riskType?: string; speciesGroups?: string[];
      beachId?: string; beachName?: string; intervalDays?: number | null; daysSinceCleanup?: number; followUpStatus?: string;
      includedCleanupCount?: number; remainingCleanupCount?: number; remainingRate?: number;
    };
  }[];
  emptyStateMessage?: string;
  links: { map: string; insights: string };
};

export type ConservationCard = {
  id: string;
  name: string;
  scientificName: string;
  intro: string;
  conservationMessage: string;
  image: string;
  credit: string;
  photoSource: string;
  photoPermission: { label: string; url: string };
  sources: { label: string; url: string }[];
  reviewDate: string;
  questions: { id: string; text: string }[];
  answers: { title: string; text: string }[];
  evidence: string;
  category: string;
};

export type WildlifeGuidance = {
  tips: string[];
  reminder: string[];
  incident: string;
  authorities: { name: string; phone?: string; telephoneUri?: string; hours?: string; url: string; lastChecked: string }[];
  reviewDate: string;
  note: string;
};

export function personalPopupKey(participantId: string): string {
  return 'radar-personal-insights-shown:' + participantId;
}

export function canAutoShowPersonalPopup(fromHome: boolean, alreadyShown: boolean, hasOpenPanel = false): boolean {
  return fromHome && !alreadyShown && !hasOpenPanel;
}

export function readSessionValue(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function saveSessionValue(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* Continue core flows when storage is unavailable. */ }
}

const DISMISSED_NEXT_ACTIONS_KEY = 'radar-dismissed-next-actions';

export function dismissedNextActionIds(): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(DISMISSED_NEXT_ACTIONS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function dismissNextAction(id: string): void {
  const ids = dismissedNextActionIds();
  if (!ids.includes(id)) saveSessionValue(DISMISSED_NEXT_ACTIONS_KEY, JSON.stringify([...ids, id]));
}

export function fallbackNextAction(loggedIn: boolean): NextAction {
  return loggedIn ? {
    id: 'report-fallback', actionLabel: 'Report litter', reasonCode: 'REPORT_LITTER',
    reason: 'A litter report can add community evidence for a supported beach.',
    destination: { type: 'report', path: '/report/photo' },
  } : {
    id: 'guest-account', actionLabel: 'Create Your Account', reasonCode: 'GUEST',
    reason: 'Get an anonymous ID to record reports and cleanups.',
    destination: { type: 'account', path: '/identity?next=/home' },
  };
}
