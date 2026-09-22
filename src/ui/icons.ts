/**
 * 介面圖示。一律 SVG，不用 emoji（專案規則）。
 * 每個都畫在 24×24 的格子裡，用 `currentColor` 吃外層文字色。
 * 線寬 2.3：細線圖示配厚邊圓角按鈕會顯得單薄，粗一點才跟得上動森式的份量。
 */
const wrap = (body: string, stroke = true): string =>
  `<svg viewBox="0 0 24 24" fill="${stroke ? 'none' : 'currentColor'}" stroke="${stroke ? 'currentColor' : 'none'}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  coin: wrap('<circle cx="12" cy="12" r="8"/><path d="M12 8.5v7M10 10.2h3a1.8 1.8 0 0 1 0 3.6h-3"/>'),
  caramel: wrap('<path d="M12 3.5c3.2 3.7 5 6.2 5 8.6a5 5 0 0 1-10 0c0-2.4 1.8-4.9 5-8.6Z"/><path d="M9.6 12.6a2.4 2.4 0 0 0 2.4 2.3"/>'),
  milk: wrap('<path d="M9 3h6v2.4l1.6 2.7V20a1 1 0 0 1-1 1H8.4a1 1 0 0 1-1-1V8.1L9 5.4Z"/><path d="M7.4 12h9.2"/>'),
  egg: wrap('<path d="M12 3.4c3 0 5.4 4 5.4 8a5.4 5.4 0 0 1-10.8 0c0-4 2.4-8 5.4-8Z"/>'),
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

/**
 * 彩色「可愛版」圖示：動作列與商店鈕用。多色填色、圓潤輪廓，
 * 讀起來是一個「東西」而不是一個符號，配大圓底磚才像主流放置遊戲的底欄。
 */
const cute = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const CUTE_ICONS = {
  caramel: cute(
    '<path d="M12 2.6c3.7 4.3 5.9 7.4 5.9 10.2a5.9 5.9 0 0 1-11.8 0c0-2.8 2.2-5.9 5.9-10.2Z" fill="#e6952e" stroke="#b9691a" stroke-width="1.2"/>' +
      '<path d="M8.9 13a3.2 3.2 0 0 0 2.2 3" stroke="#ffe0a3" stroke-width="1.8"/>',
  ),
  milk: cute(
    '<path d="M9 5.2h6l1.8 3V19.6a1.4 1.4 0 0 1-1.4 1.4H8.6a1.4 1.4 0 0 1-1.4-1.4V8.2Z" fill="#fffdf8" stroke="#8fb4d6" stroke-width="1.3"/>' +
      '<rect x="8.6" y="2.6" width="6.8" height="2.6" rx="1" fill="#8fb4d6"/>' +
      '<rect x="7.2" y="12" width="9.6" height="4.4" fill="#d5e9f7"/>' +
      '<circle cx="12" cy="14.2" r="1.2" fill="#8fb4d6"/>',
  ),
  matcha: cute(
    '<path d="M4.8 9.5h14.4l-1.3 8.4a2.6 2.6 0 0 1-2.6 2.2H8.7a2.6 2.6 0 0 1-2.6-2.2Z" fill="#a6d18a" stroke="#5f9a47" stroke-width="1.2"/>' +
      '<ellipse cx="12" cy="9.5" rx="7.2" ry="2.1" fill="#6faf55" stroke="#5f9a47" stroke-width="1.2"/>' +
      '<path d="M12 8.6c.2-2.6 1.6-4.4 4-5-.2 2.6-1.6 4.4-4 5Z" fill="#4f8c3a"/>',
  ),
  strawberry: cute(
    '<path d="M12 21.2c-4.2-1.5-7.2-5-7.2-9.4 0-2.4 1.7-4.1 4-4.1h6.4c2.3 0 4 1.7 4 4.1 0 4.4-3 7.9-7.2 9.4Z" fill="#ec5a63" stroke="#c2394a" stroke-width="1.2"/>' +
      '<path d="M12 3.2 13.6 6l3.1-.5-1.8 2.6H9.1L7.3 5.5l3.1.5Z" fill="#6faf55" stroke="#4f8c3a" stroke-width="1"/>' +
      '<g fill="#ffe5e7"><circle cx="9.6" cy="12.2" r=".8"/><circle cx="13.9" cy="11.4" r=".8"/><circle cx="11.6" cy="15.4" r=".8"/><circle cx="15" cy="15" r=".8"/></g>',
  ),
  hand: cute(
    '<path d="M9 12.4V6a1.4 1.4 0 0 1 2.8 0v5.2M11.8 11.2V5a1.4 1.4 0 0 1 2.8 0v6.2M14.6 11.6V7.6a1.4 1.4 0 0 1 2.8 0v7a6 6 0 0 1-6 6H11a4.3 4.3 0 0 1-3.6-1.9l-2.3-3.4a1.5 1.5 0 0 1 2.4-1.9L9 14.6" fill="#f9cfa6" stroke="#c98d5c" stroke-width="1.3"/>',
  ),
  dessert: cute(
    '<ellipse cx="12" cy="18.6" rx="8.4" ry="2.4" fill="#f2e3cc" stroke="#d9c4a2" stroke-width="1"/>' +
      '<path d="M7.4 17.6c-.7-4.4 1-9.6 4.6-9.6s5.3 5.2 4.6 9.6Z" fill="#f8c854" stroke="#c99a2b" stroke-width="1.1"/>' +
      '<path d="M8.4 12.6c1.2-.7 2.4-1.5 3.6-1.5s2.4.8 3.6 1.5c.1-1.8-1.3-4.2-3.6-4.2s-3.7 2.4-3.6 4.2Z" fill="#b7651d"/>' +
      '<g fill="#5a3d28"><circle cx="10.6" cy="14.6" r=".7"/><circle cx="13.4" cy="14.6" r=".7"/></g>',
  ),
  box: cute(
    '<path d="M3.6 8.4 12 4.4l8.4 4v9.2L12 21.6l-8.4-4Z" fill="#dba66e" stroke="#9e6a38" stroke-width="1.2"/>' +
      '<path d="M3.6 8.4 12 12.4l8.4-4M12 12.4v9.2" stroke="#9e6a38" stroke-width="1.2"/>' +
      '<path d="m7.6 6.5 8.4 4" stroke="#fff1d6" stroke-width="1.6"/>',
  ),
  shop: cute(
    '<path d="M4.2 10.2h15.6v8.8a1.6 1.6 0 0 1-1.6 1.6H5.8a1.6 1.6 0 0 1-1.6-1.6Z" fill="#f7dcaa" stroke="#b9853f" stroke-width="1.2"/>' +
      '<path d="M2.8 7 5 3.4h14L21.2 7v1.4a2.4 2.4 0 0 1-4.8 0 2.3 2.3 0 0 1-4.4 0 2.3 2.3 0 0 1-4.4 0 2.4 2.4 0 0 1-4.8 0Z" fill="#ec5a63" stroke="#c2394a" stroke-width="1.1"/>' +
      '<path d="M8.6 3.4 7.6 8.4M12 3.4v5M15.4 3.4l1 5" stroke="#fff4f0" stroke-width="1.2"/>' +
      '<rect x="10" y="14.4" width="4" height="6.2" rx="1" fill="#9e6a38"/>',
  ),
} as const;

export type CuteIconName = keyof typeof CUTE_ICONS;

export function cuteIcon(name: CuteIconName, cls = ''): string {
  return `<span class="ic ${cls}">${CUTE_ICONS[name]}</span>`;
}

export function icon(name: IconName, cls = ''): string {
  return `<span class="ic ${cls}">${ICONS[name]}</span>`;
}
