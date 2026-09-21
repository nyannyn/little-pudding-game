/**
 * 介面圖示。一律 SVG，不用 emoji（專案規則）。
 * 每個都畫在 24×24 的格子裡，用 `currentColor` 吃外層文字色。
 */
const wrap = (body: string, stroke = true): string =>
  `<svg viewBox="0 0 24 24" fill="${stroke ? 'none' : 'currentColor'}" stroke="${stroke ? 'currentColor' : 'none'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  coin: wrap('<circle cx="12" cy="12" r="8"/><path d="M12 8.5v7M10 10.2h3a1.8 1.8 0 0 1 0 3.6h-3"/>'),
  caramel: wrap('<path d="M12 3.5c3.2 3.7 5 6.2 5 8.6a5 5 0 0 1-10 0c0-2.4 1.8-4.9 5-8.6Z"/><path d="M9.6 12.6a2.4 2.4 0 0 0 2.4 2.3"/>'),
  milk: wrap('<path d="M9 3h6v2.4l1.6 2.7V20a1 1 0 0 1-1 1H8.4a1 1 0 0 1-1-1V8.1L9 5.4Z"/><path d="M7.4 12h9.2"/>'),
  ingredient: wrap('<path d="m12 3.6 7.2 4.2v8.4L12 20.4 4.8 16.2V7.8Z"/><path d="M4.8 7.8 12 12l7.2-4.2M12 12v8.4"/>'),
  dessert: wrap('<path d="M5.4 10.5h13.2l-1.5 8a1.6 1.6 0 0 1-1.6 1.3H8.5a1.6 1.6 0 0 1-1.6-1.3Z"/><path d="M8.6 10.5c0-3 1.5-4.7 3.4-4.7s3.4 1.7 3.4 4.7"/><path d="M12 3.2v1.4"/>'),
  basin: wrap('<path d="M3.8 10.5h16.4l-1.2 6.2a2.4 2.4 0 0 1-2.4 2H7.4a2.4 2.4 0 0 1-2.4-2Z"/><path d="M8.2 7.4c0-1.1.9-2 2-2M13.8 6.6c0-1.1.9-2 2-2"/>'),
  hand: wrap('<path d="M9 12V5.6a1.4 1.4 0 0 1 2.8 0V11"/><path d="M11.8 11V4.8a1.4 1.4 0 0 1 2.8 0V11"/><path d="M14.6 11.4V7.2a1.4 1.4 0 0 1 2.8 0v7.3a6 6 0 0 1-6 6H11a4.2 4.2 0 0 1-3.5-1.9l-2.2-3.3a1.5 1.5 0 0 1 2.3-1.9L9 14.4"/>'),
  gear: wrap('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.5 12H2.1M21.9 12h-2.4M6.7 6.7 5 5M19 19l-1.7-1.7M6.7 17.3 5 19M19 5l-1.7 1.7"/>'),
  cart: wrap('<circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/><path d="M2.8 3.6h2.6l2.4 11h10l2-7.6H6.4"/>'),
  order: wrap('<path d="M5.6 3.6h12.8v16.8l-2.1-1.6-2.1 1.6-2.2-1.6-2.1 1.6-2.2-1.6-2.1 1.6Z"/><path d="M8.6 8.4h6.8M8.6 12h4.6"/>'),
  close: wrap('<path d="m6 6 12 12M18 6 6 18"/>'),
  sound: wrap('<path d="M4.8 9.4h3l4-3.2v11.6l-4-3.2h-3Z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6"/>'),
  mute: wrap('<path d="M4.8 9.4h3l4-3.2v11.6l-4-3.2h-3Z"/><path d="m15.4 9.6 4 4.8M19.4 9.6l-4 4.8"/>'),
  pudding: wrap('<path d="M5.6 12.6c0-3.3 2.9-6 6.4-6s6.4 2.7 6.4 6v2.2c0 2-2.9 3.6-6.4 3.6s-6.4-1.6-6.4-3.6Z"/><path d="M6.2 11c1.4 1.1 3.5.4 5-.2s3.5-.9 5 .6"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ''): string {
  return `<span class="ic ${cls}">${ICONS[name]}</span>`;
}
