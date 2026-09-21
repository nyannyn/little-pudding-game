// 抓商店商品插圖：Microsoft Fluent Emoji 的 3D 版（MIT 授權），縮成 160px WebP。
//
// 為什麼用這套：使用者指定「下載精緻的免費素材包」；Fluent 3D 是免費素材裡少數
// 有一致光影、圓潤立體、跟本作 toon 3D 布丁同一個語氣的整套圖，而且 MIT 可商用、
// 不必標示作者（但授權全文要一起進 repo，見同目錄 LICENSE.txt）。
// 原檔 256px PNG 約 30 KB／張；卡片只顯示 64–72 CSS px，160px 在 3x 螢幕仍夠清楚，
// WebP 後每張約 5–8 KB，二十張不到 200 KB。
//
// 用法：node tools/fetch-shop-art.mjs
// 輸出：src/assets/shop/<key>.webp ＋ src/assets/shop/LICENSE.txt
// 只要 ART 表沒改就不必重跑；輸出檔已進版控。
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const REPO = 'microsoft/fluentui-emoji';
// 釘在一個 commit：上游改圖不會讓我們的資產無聲變樣
const COMMIT = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc';
const OUT = 'src/assets/shop';
const SIZE = 160;

/** 我們的商品 key → Fluent Emoji 的資產目錄名 */
const ART = {
  caramel: 'Honey pot',
  milk: 'Glass of milk',
  matcha: 'Teacup without handle',
  strawberry: 'Strawberry',
  autoFill: 'Shower',
  collector: 'Magnet',
  crafter: 'Factory',
  seller: 'Convenience store',
  restock: 'Scroll',
  bathtub: 'Bathtub',
  window: 'Window',
  store: 'Department store',
  ingCaramel: 'Chocolate bar',
  ingPanna: 'Butter',
  jar: 'Jar',
  custard: 'Custard',
  hojicha: 'Hot beverage',
  candy: 'Candy',
  sakura: 'Cherry blossom',
  lock: 'Locked',
  star: 'Star',
};

const slug = (name) => name.toLowerCase().replace(/ /g, '_');
const rawUrl = (name) =>
  `https://raw.githubusercontent.com/${REPO}/${COMMIT}/assets/${encodeURIComponent(name)}/3D/${slug(name)}_3d.png`;

mkdirSync(OUT, { recursive: true });

const license = await (await fetch(`https://raw.githubusercontent.com/${REPO}/${COMMIT}/LICENSE`)).text();
writeFileSync(
  `${OUT}/LICENSE.txt`,
  `商店商品插圖來自 Microsoft Fluent Emoji（3D 版）\nhttps://github.com/${REPO}  commit ${COMMIT}\n` +
    `由 tools/fetch-shop-art.mjs 縮成 ${SIZE}px WebP。授權全文如下：\n\n${license}`,
  'utf8',
);

const browser = await chromium.launch();
const page = await browser.newPage();
let total = 0;
for (const [key, name] of Object.entries(ART)) {
  const res = await fetch(rawUrl(name));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const png = Buffer.from(await res.arrayBuffer()).toString('base64');
  // 在瀏覽器裡用 canvas 縮圖再匯出 WebP：專案本來就有 Playwright，不必再裝影像函式庫
  const dataUrl = await page.evaluate(
    async ({ png, size }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/webp', 0.9);
    },
    { png, size: SIZE },
  );
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(`${OUT}/${key}.webp`, bytes);
  total += bytes.length;
  console.log(`${key.padEnd(12)} ← ${name.padEnd(24)} ${bytes.length} bytes`);
}
await browser.close();
console.log(`\n${Object.keys(ART).length} 張，共 ${total} bytes → ${OUT}/`);
