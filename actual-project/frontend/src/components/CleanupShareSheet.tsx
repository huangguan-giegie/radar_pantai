import { useEffect, useState } from 'react';
import type { CleanupAction } from '../iteration2';
import { CLEANUP_SHARE_THEMES, createCleanupShareImage, type CleanupShareTheme } from '../cleanupShare';
import { Sheet } from './CoastalUI';
import { GhostButton, PrimaryButton } from './ui';

export function CleanupShareSheet({ cleanup, onClose }: { cleanup: CleanupAction; onClose: () => void }) {
  const [theme, setTheme] = useState<CleanupShareTheme>('ocean');
  const [background, setBackground] = useState<'ocean' | 'beach'>('ocean');
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let url = '';
    setPreview(null);
    setError('');
    createCleanupShareImage(cleanup, theme, background).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPreview({ url, file: new File([blob], 'radar-pantai-cleanup.png', { type: 'image/png' }) });
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not create the image.'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [cleanup, theme, background]);
  const canShareImage = !!preview && typeof navigator.share === 'function'
    && !!navigator.canShare?.({ files: [preview.file] });
  const download = () => {
    if (!preview) return;
    const link = document.createElement('a');
    link.href = preview.url;
    link.download = 'radar-pantai-cleanup-' + cleanup.id + '.png';
    link.click();
  };
  const share = async () => {
    if (!preview || busy || !canShareImage) return;
    setError('');
    setBusy(true);
    try { await navigator.share({ files: [preview.file], title: 'My cleanup at ' + cleanup.beachName }); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError('Sharing is unavailable. Save the image to share it.'); }
    finally { setBusy(false); }
  };
  return <Sheet title="Share Your Cleanup" onClose={onClose}>
    <p className="subtle">Create an image from your recorded result.</p>
    <fieldset className="share-image-options"><legend>Background</legend>
      {(['ocean', 'beach'] as const).map(value => <button type="button" key={value} aria-pressed={background === value} onClick={() => setBackground(value)}>{value === 'ocean' ? 'Marine Life' : 'Beach'}</button>)}
    </fieldset>
    <fieldset className="share-image-options"><legend>Colour</legend>
      {(Object.keys(CLEANUP_SHARE_THEMES) as CleanupShareTheme[]).map(value => <button type="button" key={value} aria-label={value + ' colour'} aria-pressed={theme === value} style={{ background: CLEANUP_SHARE_THEMES[value] }} onClick={() => setTheme(value)}>{theme === value ? '✓' : ''}</button>)}
    </fieldset>
    {preview ? <img className="cleanup-share-preview" src={preview.url} alt={'Share image showing the recorded cleanup at ' + cleanup.beachName} /> : !error && <p role="status">Creating your image…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="cleanup-share-actions">
    {canShareImage ? <>
      <PrimaryButton height={46} disabled={busy} onClick={() => void share()}>{busy ? 'Opening Share…' : 'Share Image'}</PrimaryButton>
      <GhostButton height={44} onClick={download}>Save Image</GhostButton>
    </> : <PrimaryButton height={46} disabled={!preview} onClick={download}>Save Image</PrimaryButton>}
    </div>
  </Sheet>;
}
