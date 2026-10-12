import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  navigate: vi.fn(),
  patchDraft: vi.fn(),
  // One instance, not a fresh one per render. The screen's effect depends on
  // `params`, so a new object every time would re-run recognition on each
  // render and the screen would never settle. The real hook memoises; this has
  // to as well.
  params: new URLSearchParams(''),
  suggestion: null as null | {
    modelState: string;
    modelVersion: string;
    suggestions: Record<string, string>;
    supportedClasses: string[];
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => testState.navigate,
  useSearchParams: () => [testState.params],
}));
vi.mock('./AppContext', () => ({
  useApp: () => ({
    draft: {
      photo: { photoKey: 'photo-1', previewUrl: 'blob:photo', metadataStripped: true },
      existingPhotoKey: null, existingPhotoUrl: null,
      beachId: 'morib', beachName: 'Pantai Morib',
      quantities: {}, aiModelState: null, aiModelVersion: null, aiDecision: null,
    },
    patchDraft: testState.patchDraft,
  }),
}));
vi.mock('./api', () => ({ photoPreviewUrl: () => null }));
vi.mock('./navigation', () => ({ useAppBack: () => () => {} }));
vi.mock('./iteration2', () => ({ analyseReportPhoto: async () => testState.suggestion }));

import AiSuggestionScreen from './screens/AiSuggestionScreen';

const ALL_CATEGORIES = ['Plastic', 'Fishing gear', 'Glass', 'Metal', 'Paper', 'Other'];

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return textOf((node as { children?: unknown }).children);
}

/** The words inside the chip row carrying this aria-label, or null if the row
 *  is not on the screen at all. */
function groupText(tree: unknown, label: string): string | null {
  let found: string | null = null;
  const walk = (node: unknown): void => {
    if (found !== null || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const current = node as { props?: Record<string, unknown>; children?: unknown };
    if (current.props?.role === 'group' && current.props['aria-label'] === label) {
      found = textOf(current.children);
      return;
    }
    walk(current.children);
  };
  walk(tree);
  return found;
}

const FOUND = 'Categories the AI found';
const MISSED = 'Categories the AI did not find';

async function renderWith(suggestions: Record<string, string>) {
  testState.suggestion = { modelState: 'ready', modelVersion: 'v1', suggestions, supportedClasses: [] };
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<AiSuggestionScreen />); });
  return view;
}

beforeEach(() => { vi.clearAllMocks(); });

// The card used to be headed "DETECTED CATEGORIES" and list all six, so a photo
// the AI read as plastic and glass still claimed six detections. The heading now
// covers only what was really found, and everything else moved to its own row -
// kept on the screen, because seeing metal in a photo the AI called plastic is
// exactly when a person needs to add it.
describe('What the AI suggestion screen claims', () => {
  it('lists only the reported categories under the detected heading', async () => {
    const view = await renderWith({ Plastic: 'Medium', Glass: 'Small' });
    try {
      const found = groupText(view.toJSON(), FOUND);
      expect(found).toContain('Plastic');
      expect(found).toContain('Glass');
      for (const missed of ['Fishing gear', 'Metal', 'Paper', 'Other']) expect(found).not.toContain(missed);
    } finally { act(() => view.unmount()); }
  });

  it('keeps the categories it missed one tap away', async () => {
    const view = await renderWith({ Plastic: 'Medium', Glass: 'Small' });
    try {
      const missed = groupText(view.toJSON(), MISSED);
      for (const category of ['Fishing gear', 'Metal', 'Paper', 'Other']) expect(missed).toContain(category);
      expect(missed).not.toContain('Plastic');
      expect(missed).not.toContain('Glass');
    } finally { act(() => view.unmount()); }
  });

  it('offers every category across the two rows, so none becomes unreachable', async () => {
    const view = await renderWith({ Plastic: 'Medium' });
    try {
      const tree = view.toJSON();
      const all = `${groupText(tree, FOUND)} ${groupText(tree, MISSED)}`;
      for (const category of ALL_CATEGORIES) expect(all).toContain(category);
    } finally { act(() => view.unmount()); }
  });

  it('says the AI named nothing instead of showing an empty heading', async () => {
    const view = await renderWith({});
    try {
      const tree = view.toJSON();
      expect(groupText(tree, FOUND)).toBeNull();
      expect(JSON.stringify(tree)).toContain('The AI did not name a category');
      for (const category of ALL_CATEGORIES) expect(groupText(tree, MISSED)).toContain(category);
    } finally { act(() => view.unmount()); }
  });

  // The detected list is frozen when the result arrives. If it tracked the live
  // selection, tapping a chip would slide it into the row above and the chip
  // under the user's finger would move mid-tap.
  it('does not move a chip between rows when it is ticked', async () => {
    const view = await renderWith({ Plastic: 'Medium', Glass: 'Small' });
    try {
      const metal = view.root.findAllByType('button').find((button) => button.children.join('') === 'Metal');
      expect(metal).toBeDefined();
      act(() => metal!.props.onClick());
      const tree = view.toJSON();
      expect(groupText(tree, FOUND)).not.toContain('Metal');
      expect(groupText(tree, MISSED)).toContain('Metal');
    } finally { act(() => view.unmount()); }
  });

  it('numbers the screen as step 4 of 5, the same step as the manual form', async () => {
    const view = await renderWith({ Plastic: 'Medium' });
    try {
      expect(JSON.stringify(view.toJSON())).toContain('STEP 4 OF 5 · AI CHECK');
    } finally { act(() => view.unmount()); }
  });
});
