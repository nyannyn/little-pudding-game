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
  storage: wrap('<path d="M3.6 9.6 12 4.2l8.4 5.4V20H3.6Z"/><path d="M7.4 20v-7.2h9.2V20M7.4 15.4h9.2M7.4 17.8h9.2"/>'),
  close: wrap('<path d="m6 6 12 12M18 6 6 18"/>'),
  sound: wrap('<path d="M4.8 9.4h3l4-3.2v11.6l-4-3.2h-3Z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6"/>'),
  mute: wrap('<path d="M4.8 9.4h3l4-3.2v11.6l-4-3.2h-3Z"/><path d="m15.4 9.6 4 4.8M19.4 9.6l-4 4.8"/>'),
  trophy: wrap('<path d="M7.4 4.2h9.2v4.6a4.6 4.6 0 0 1-9.2 0Z"/><path d="M7.4 6H4.6a2.6 2.6 0 0 0 2.9 3.4M16.6 6h2.8a2.6 2.6 0 0 1-2.9 3.4M12 13.4v3.4M8.6 20h6.8l-.8-3.2H9.4Z"/>'),
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
  // ── 甜點工坊（D51）──
  bakery: cute(
    '<path d="M4 10h16v9.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.4Z" fill="#fde2e8" stroke="#d9708b" stroke-width="1.2"/>' +
      '<path d="M2.8 7.2 5 3.4h14l2.2 3.8v1.2a2.2 2.2 0 0 1-4.4 0 2.2 2.2 0 0 1-4.4 0 2.2 2.2 0 0 1-4.4 0 2.2 2.2 0 0 1-4.4 0Z" fill="#f28aa3" stroke="#d9708b" stroke-width="1.1"/>' +
      '<path d="M8.4 3.4 7.4 8.4M12 3.4v5M15.6 3.4l1 5" stroke="#fff" stroke-width="1.2"/>' +
      '<path d="M8.4 18.6c-.4-2.6.8-4.8 3.6-4.8s4 2.2 3.6 4.8Z" fill="#f8c854" stroke="#c99a2b" stroke-width="1"/>' +
      '<path d="M9.4 15.6c.9-.5 1.7-.9 2.6-.9s1.7.4 2.6.9" stroke="#b7651d" stroke-width="1.2"/>',
  ),
  farm: cute(
    '<rect x="4.6" y="3.4" width="14.8" height="17.2" rx="2" fill="#e8f6fb" stroke="#7fb3c8" stroke-width="1.2"/>' +
      '<path d="M4.6 9.2h14.8M4.6 14.8h14.8" stroke="#7fb3c8" stroke-width="1.1"/>' +
      '<path d="M8.6 14.4c0-2 1.5-3.4 3.4-3.4s3.4 1.4 3.4 3.4" fill="#f8c854" stroke="#c99a2b" stroke-width="1"/>' +
      '<path d="M9.4 11.9c.8-.4 1.7-.7 2.6-.7s1.8.3 2.6.7" stroke="#b7651d" stroke-width="1.1"/>',
  ),
  crack: cute(
    '<path d="M5 14.4h14l-1.6 5a1.8 1.8 0 0 1-1.7 1.2H8.3a1.8 1.8 0 0 1-1.7-1.2Z" fill="#9fd9c4" stroke="#5fae93" stroke-width="1.2"/>' +
      '<path d="M8.6 10.6C8.4 6.8 10 3.6 12 3.6s3.6 3.2 3.4 7l-1.4-1-1.2 1.2-1.2-1.2-1.2 1.2Z" fill="#fff4dc" stroke="#d9b98a" stroke-width="1.1"/>' +
      '<circle cx="12" cy="14.2" r="2" fill="#ffc83d"/>',
  ),
  mix: cute(
    '<path d="M4.8 11.4h14.4l-1.4 6.6a2.4 2.4 0 0 1-2.3 1.9H8.5a2.4 2.4 0 0 1-2.3-1.9Z" fill="#d6dee6" stroke="#8d9aa8" stroke-width="1.2"/>' +
      '<path d="M5.6 11.4c1.4-1.4 3.8-2 6.4-2s5 .6 6.4 2Z" fill="#f7c9d4"/>' +
      '<path d="M12 2.8v7.8" stroke="#8d9aa8" stroke-width="1.4"/>' +
      '<path d="M12 10.4c-2.2 0-3-1.6-3-3.2s1.2-2.2 3-2.2 3 .6 3 2.2-.8 3.2-3 3.2Z" stroke="#8d9aa8" stroke-width="1.2"/>',
  ),
  mold: cute(
    '<path d="M9.4 3.4h5.2l-1.4 4.4h-2.4Z" fill="#ffe08f" stroke="#d9a93e" stroke-width="1.1"/>' +
      '<path d="M12 8.2v2.6" stroke="#f08aa2" stroke-width="1.6"/>' +
      '<path d="M5.4 13h5.4l-.8 6.6H6.2ZM13.2 13h5.4l-.8 6.6H14Z" fill="#ffc4d2" stroke="#e07d95" stroke-width="1.1"/>' +
      '<path d="M5.8 15.2h4.6M13.6 15.2h4.6" stroke="#f8c854" stroke-width="2"/>',
  ),
  oven: cute(
    '<rect x="3.6" y="4" width="16.8" height="16" rx="2.4" fill="#c7b5f0" stroke="#8f76c9" stroke-width="1.2"/>' +
      '<rect x="6.4" y="9.6" width="11.2" height="7.6" rx="1.4" fill="#ffb04d" stroke="#8f76c9" stroke-width="1.1"/>' +
      '<g fill="#8f76c9"><circle cx="7.4" cy="6.6" r="1"/><circle cx="10.4" cy="6.6" r="1"/></g>' +
      '<path d="M9.4 15.4c0-1.6 1.2-2.6 2.6-2.6s2.6 1 2.6 2.6Z" fill="#fff4dc"/>',
  ),
  decorate: cute(
    '<path d="M6.2 13.6h11.6l-1.2 6.2H7.4Z" fill="#ffc4d2" stroke="#e07d95" stroke-width="1.1"/>' +
      '<path d="M7 13.6c.2-2 2.4-3.4 5-3.4s4.8 1.4 5 3.4Z" fill="#fff8ee" stroke="#e0c8a8" stroke-width="1"/>' +
      '<path d="M10.4 10.2c.2-1.4.8-2.2 1.6-2.2s1.4.8 1.6 2.2" fill="#fff8ee" stroke="#e0c8a8" stroke-width="1"/>' +
      '<circle cx="12" cy="6.8" r="1.6" fill="#ec5a63"/>' +
      '<g fill="#9fd9c4"><circle cx="9.2" cy="12.2" r=".6"/><circle cx="14.6" cy="12" r=".6"/></g>',
  ),
  shelf: cute(
    '<rect x="3.4" y="5" width="17.2" height="15" rx="1.6" fill="#f4a3b6" stroke="#d9708b" stroke-width="1.2"/>' +
      '<rect x="5" y="6.6" width="14" height="11.8" rx="1" fill="#eef8ff" stroke="#fff" stroke-width="1"/>' +
      '<path d="M5 12.6h14" stroke="#d9708b" stroke-width="1.1"/>' +
      '<path d="M7 12.4c0-1.6.8-2.6 1.8-2.6s1.8 1 1.8 2.6ZM13.4 12.4c0-1.6.8-2.6 1.8-2.6s1.8 1 1.8 2.6ZM10.2 18.2c0-1.6.8-2.6 1.8-2.6s1.8 1 1.8 2.6Z" fill="#f8c854"/>',
  ),
  // ── 成就獎章（D55）──
  pudding: cute(
    '<ellipse cx="12" cy="19" rx="7.6" ry="1.7" fill="#f2e3cc" stroke="#d9c4a2" stroke-width="1"/>' +
      '<path d="M6 18.6c-.6-5.2 1.6-10.4 6-10.4s6.6 5.2 6 10.4Z" fill="#fbd46a" stroke="#c99a2b" stroke-width="1.2"/>' +
      '<path d="M7.4 11.6c1.4-.8 3-1.6 4.6-1.6s3.2.8 4.6 1.6c-.3-2.6-2-4.4-4.6-4.4s-4.3 1.8-4.6 4.4Z" fill="#b7651d"/>' +
      '<g fill="#5a3d28"><circle cx="10.4" cy="14.6" r=".8"/><circle cx="13.6" cy="14.6" r=".8"/></g>' +
      '<g fill="#f4a7b0"><ellipse cx="8.8" cy="16" rx="1" ry=".6"/><ellipse cx="15.2" cy="16" rx="1" ry=".6"/></g>',
  ),
  basin: cute(
    '<g fill="#fff" stroke="#8fc3db" stroke-width=".9"><circle cx="8" cy="6.6" r="1.6"/><circle cx="11.8" cy="4.6" r="1.2"/><circle cx="15" cy="6.8" r="1.8"/></g>' +
      '<path d="M3.4 11h17.2l-1.4 6.4a2.6 2.6 0 0 1-2.5 2H7.3a2.6 2.6 0 0 1-2.5-2Z" fill="#9fd3ea" stroke="#5c9dbb" stroke-width="1.2"/>' +
      '<rect x="2.6" y="9.6" width="18.8" height="2.4" rx="1.2" fill="#fffdf8" stroke="#5c9dbb" stroke-width="1.1"/>',
  ),
  book: cute(
    '<path d="M4 5.2c2.6-.8 5.4-.6 8 1v13.6c-2.6-1.6-5.4-1.8-8-1Z" fill="#f7a7bb" stroke="#c2566f" stroke-width="1.2"/>' +
      '<path d="M20 5.2c-2.6-.8-5.4-.6-8 1v13.6c2.6-1.6 5.4-1.8 8-1Z" fill="#fbd46a" stroke="#c99a2b" stroke-width="1.2"/>' +
      '<path d="M6.2 9.4c1.4-.2 2.8 0 4 .6M13.8 10c1.2-.6 2.6-.8 4-.6M6.2 12.6c1.4-.2 2.8 0 4 .6M13.8 13.2c1.2-.6 2.6-.8 4-.6" stroke="#fff8e8" stroke-width="1.1"/>',
  ),
  sparkle: cute(
    '<path d="M11 3.2c.6 4 1.8 5.4 5.8 6-4 .6-5.2 2-5.8 6-.6-4-1.8-5.4-5.8-6 4-.6 5.2-2 5.8-6Z" fill="#fbd46a" stroke="#d9a02f" stroke-width="1.1"/>' +
      '<path d="M17.6 13.6c.3 2 .9 2.7 2.9 3-2 .3-2.6 1-2.9 3-.3-2-.9-2.7-2.9-3 2-.3 2.6-1 2.9-3Z" fill="#f7a7bb" stroke="#d9708b" stroke-width="1"/>' +
      '<circle cx="6" cy="18" r="1.3" fill="#9fd3ea"/>',
  ),
  heart: cute(
    '<path d="M12 20.2c-4.8-3-8.2-6.2-8.2-9.8a4.2 4.2 0 0 1 8.2-1.3 4.2 4.2 0 0 1 8.2 1.3c0 3.6-3.4 6.8-8.2 9.8Z" fill="#ec5a63" stroke="#c2394a" stroke-width="1.2"/>' +
      '<path d="M7.2 9.4a2 2 0 0 1 2-1.4" stroke="#ffd6da" stroke-width="1.6"/>',
  ),
  order: cute(
    '<path d="M5.6 3.4h12.8v17.2l-2.1-1.5-2.1 1.5-2.2-1.5-2.1 1.5-2.2-1.5-2.1 1.5Z" fill="#fffdf8" stroke="#c99a6a" stroke-width="1.2"/>' +
      '<path d="M8.4 8h7.2M8.4 11.4h5" stroke="#c99a6a" stroke-width="1.3"/>' +
      '<circle cx="15" cy="15.2" r="2.1" fill="#ec5a63" stroke="#c2394a" stroke-width=".9"/>',
  ),
  coin: cute(
    '<circle cx="12" cy="12" r="8.6" fill="#ffd96a" stroke="#c9901c" stroke-width="1.3"/>' +
      '<circle cx="12" cy="12" r="6.2" stroke="#f0b53a" stroke-width="1"/>' +
      '<path d="M12 8.6v6.8M10.2 10.2h2.6a1.7 1.7 0 0 1 0 3.4h-2.6" stroke="#a86d12" stroke-width="1.5"/>' +
      '<path d="M7.4 9.4a5 5 0 0 1 2.4-2.6" stroke="#fff4c8" stroke-width="1.4"/>',
  ),
  trophy: cute(
    '<path d="M7.2 5.4H4.6a2.8 2.8 0 0 0 3.2 3.8M16.8 5.4h2.6a2.8 2.8 0 0 1-3.2 3.8" stroke="#c9901c" stroke-width="1.3"/>' +
      '<path d="M7.2 3.6h9.6v5.2a4.8 4.8 0 0 1-9.6 0Z" fill="#ffd96a" stroke="#c9901c" stroke-width="1.2"/>' +
      '<path d="M10.6 13.4h2.8v3.4h-2.8Z" fill="#f0b53a"/>' +
      '<path d="M7.8 20.4h8.4l-.8-3.8H8.6Z" fill="#b8834f" stroke="#8f5f33" stroke-width="1.1"/>' +
      '<path d="M9.4 5.6v3" stroke="#fff4c8" stroke-width="1.4"/>',
  ),
} as const;

export type CuteIconName = keyof typeof CUTE_ICONS;

export function cuteIcon(name: CuteIconName, cls = ''): string {
  return `<span class="ic ${cls}">${CUTE_ICONS[name]}</span>`;
}

export function icon(name: IconName, cls = ''): string {
  return `<span class="ic ${cls}">${ICONS[name]}</span>`;
}
