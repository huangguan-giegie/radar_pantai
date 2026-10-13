import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CleanupAction } from '../iteration2';
import { createCleanupShareImage } from '../cleanupShare';
import { CleanupShareSheet } from './CleanupShareSheet';

vi.mock('../cleanupShare', () => ({
  CLEANUP_SHARE_THEMES: { ocean: '#0b2161' },
  createCleanupShareImage: vi.fn(),
}));
vi.mock('./CoastalUI', () => ({ Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const cleanup = { id: 'cleanup-1', beachName: 'Pantai Remis' } as CleanupAction;
let view: ReactTestRenderer;
const clickDownload = vi.fn();
const link = { href: '', download: '', click: clickDownload };
const createElement = vi.fn(() => link);
const nativeShare = vi.fn();
const canShare = vi.fn();
const button = (label: string) => view.root.findAllByType('button').find(node => node.children.join('') === label);
async function render() {
  await act(async () => { view = create(<CleanupShareSheet cleanup={cleanup} onClose={vi.fn()} />); });
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeShare.mockReset().mockResolvedValue(undefined);
  canShare.mockReset().mockReturnValue(true);
  vi.stubGlobal('navigator', { share: nativeShare, canShare });
  vi.stubGlobal('document', { createElement });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cleanup-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.mocked(createCleanupShareImage).mockResolvedValue(new Blob(['cleanup image'], { type: 'image/png' }));
});
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cleanup image actions', () => {
  it.each(['missing-share', 'missing-can-share', 'unsupported-file'])('offers only Save Image when sharing is unavailable: %s', async (support) => {
    if (support === 'missing-share') vi.stubGlobal('navigator', { canShare });
    if (support === 'missing-can-share') vi.stubGlobal('navigator', { share: nativeShare });
    if (support === 'unsupported-file') canShare.mockReturnValue(false);
    await render();
    expect(button('Share Image')).toBeUndefined();
    expect(button('Save Image')?.props.disabled).toBe(false);
    act(() => button('Save Image')!.props.onClick());
    expect(createElement).toHaveBeenCalledWith('a');
    expect(link.href).toBe('blob:cleanup-preview');
    expect(link.download).toBe('radar-pantai-cleanup-cleanup-1.png');
    expect(clickDownload).toHaveBeenCalledOnce();
    expect(nativeShare).not.toHaveBeenCalled();
  });

  it('passes the generated PNG to native sharing without downloading it', async () => {
    await render();
    await act(async () => { button('Share Image')!.props.onClick(); });
    expect(nativeShare).toHaveBeenCalledOnce();
    const data = nativeShare.mock.calls[0][0] as ShareData;
    expect(data.title).toBe('My cleanup at Pantai Remis');
    expect(data.files).toHaveLength(1);
    expect(data.files![0].name).toBe('radar-pantai-cleanup.png');
    expect(data.files![0].type).toBe('image/png');
    expect(await data.files![0].text()).toBe('cleanup image');
    expect(clickDownload).not.toHaveBeenCalled();
  });

  it('keeps Save Image as a separate download action on supported browsers', async () => {
    await render();
    act(() => button('Save Image')!.props.onClick());
    expect(clickDownload).toHaveBeenCalledOnce();
    expect(nativeShare).not.toHaveBeenCalled();
  });

  it('does not download or show an error when the user cancels sharing', async () => {
    nativeShare.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    await render();
    await act(async () => { button('Share Image')!.props.onClick(); });
    expect(clickDownload).not.toHaveBeenCalled();
    expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(button('Share Image')?.props.disabled).toBe(false);
  });

  it('reports a sharing failure without silently downloading and clears it on retry', async () => {
    nativeShare.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await render();
    await act(async () => { button('Share Image')!.props.onClick(); });
    expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('Save the image to share it.');
    expect(clickDownload).not.toHaveBeenCalled();
    await act(async () => { button('Share Image')!.props.onClick(); });
    expect(view.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });
});
