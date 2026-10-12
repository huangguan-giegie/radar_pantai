import type { CleanupAction } from './iteration2';

export const CLEANUP_SHARE_THEMES = { ocean: '#0b2161', teal: '#086d73', coral: '#b54d37' } as const;
export type CleanupShareTheme = keyof typeof CLEANUP_SHARE_THEMES;

/** Use only saved amounts; a quantity category is neither a bag count nor a beach rating. */
export function cleanupShareLines(cleanup: CleanupAction): string[] {
  return cleanup.rows.map(row => row.beforeBand
    ? `${row.category}: ${row.beforeBand} → ${row.afterBand ?? 'Not recorded'}`
    : `${row.category}: ${row.removedBand ?? 'Not recorded'} collected`);
}

export async function createCleanupShareImage(cleanup: CleanupAction, theme: CleanupShareTheme, background: 'ocean' | 'beach'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is not supported by this browser.');
  const color = CLEANUP_SHARE_THEMES[theme];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const photo = new Image();
    photo.src = background === 'ocean' ? '/images/coastal/marine-life-feedback.png' : '/home/morib-beach-dusk.jpg';
    await photo.decode();
    const scale = Math.max(1080 / photo.width, 430 / photo.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 1080, 430);
    ctx.clip();
    ctx.drawImage(photo, (1080 - photo.width * scale) / 2, (430 - photo.height * scale) / 2, photo.width * scale, photo.height * scale);
    ctx.restore();
    const shade = ctx.createLinearGradient(0, 0, 0, 460);
    shade.addColorStop(0, 'rgba(0,0,0,.12)');
    shade.addColorStop(1, color);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 1080, 460);
  } catch { /* The saved record still exports when a decorative photo fails. */ }
  ctx.fillStyle = '#b8ff36';
  ctx.font = '700 28px sans-serif';
  ctx.fillText('RADAR PANTAI', 72, 76);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 50px sans-serif';
  ctx.fillText('I did a beach cleanup', 72, 355);
  let y = 435;
  const text = (value: string, font: string, fill: string, lineHeight: number, width = 936) => {
    ctx.font = font;
    ctx.fillStyle = fill;
    let line = '';
    for (const word of value.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > width) { ctx.fillText(line, 72, y); y += lineHeight; line = word; }
      else line = next;
    }
    if (line) { ctx.fillText(line, 72, y); y += lineHeight; }
  };
  text(cleanup.beachName, '700 44px sans-serif', '#ffffff', 55);
  text(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(cleanup.createdAt)), '400 26px sans-serif', '#ffffffcc', 38);
  y += 32;
  text('MY RECORDED CLEANUP', '700 24px sans-serif', '#b8ff36', 38);
  for (const line of cleanupShareLines(cleanup)) text(line, '600 30px sans-serif', '#ffffff', 43);
  y += 22;
  if (cleanup.handling && cleanup.handling !== 'Not recorded') text(`Disposal: ${cleanup.handling}`, '400 27px sans-serif', '#ffffffdd', 38);
  y = Math.max(y + 55, 1035);
  text('One cleanup. One step toward a cleaner coast.', '700 34px sans-serif', '#ffffff', 46);
  text('Reducing litter can help protect coastal habitats.', '400 26px sans-serif', '#ffffffcc', 38);
  ctx.font = '400 23px sans-serif';
  ctx.fillStyle = '#ffffffaa';
  if (background === 'beach') ctx.fillText('creativecommons.org/licenses/by-sa/4.0', 72, 1210);
  ctx.fillText(background === 'beach' ? 'Photo: Ajayrb135 · CC BY-SA 4.0 · cropped' : 'Photo supplied by the project team', 72, 1245);
  ctx.fillText('Participant-recorded amounts · SDG 14: Life Below Water', 72, 1280);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the image.')), 'image/png'));
}
