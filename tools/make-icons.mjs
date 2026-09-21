// 產 PWA 圖示。用 Playwright 把一張 SVG 畫成 PNG——
// 專案本來就有 Playwright，不必為了三張圖再裝一個影像函式庫。
//
// 用法：node tools/make-icons.mjs
// 輸出：public/icons/icon-{192,512}.png、public/icons/apple-touch-icon.png（180，iOS 只吃 PNG）
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

// maskable 圖示的安全區是中心 80%，所以布丁要畫小一點、四周留白
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f6e7d2"/>
  <ellipse cx="256" cy="392" rx="150" ry="22" fill="#e3cdb0"/>
  <path d="M136 372c0-96 54-156 120-156s120 60 120 156c0 14-54 24-120 24s-120-10-120-24z" fill="#ffc857"/>
  <path d="M150 268c0-52 47-92 106-92s106 40 106 92c0 18-22 12-38 22-18 11-31-6-50-6s-33 19-52 8c-18-10-34-6-50-14-14-7-22-4-22-10z" fill="#b4651f"/>
  <ellipse cx="214" cy="322" rx="13" ry="18" fill="#4a3423"/>
  <ellipse cx="298" cy="322" rx="13" ry="18" fill="#4a3423"/>
  <ellipse cx="178" cy="344" rx="20" ry="12" fill="#f3b6bd" opacity="0.85"/>
  <ellipse cx="334" cy="344" rx="20" ry="12" fill="#f3b6bd" opacity="0.85"/>
</svg>`;
writeFileSync(`${OUT}/icon.svg`, svg, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [192, 512, 180]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const name = size === 180 ? 'apple-touch-icon' : `icon-${size}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, omitBackground: false });
  console.log(`${OUT}/${name}.png  ${size}x${size}`);
}
await browser.close();
