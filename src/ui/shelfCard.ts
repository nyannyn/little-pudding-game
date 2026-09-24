import { shelfCount, spareDesserts, walkInPrice } from '../game/bakery';
import { BALANCE } from '../game/balance';
import { DESSERT_IDS, dessertName, dessertPrice, type DessertId } from '../game/recipes';
import { REGULAR_BALANCE } from '../game/regulars';
import type { GameState } from '../game/state';
import { STARS, stockOf, type Star } from '../game/stock';
import { starsHtml } from './icons';
import { artHtml } from './shop';
import { dessertArt } from './shopArt';

/**
 * 上架卡（D70）：成品櫃與展示架按星級分列。
 * 「全部上架」照店員那套規則（先上低星）；逐列的「上架 1」讓玩家自己決定要不要把高星擺出去——
 * 散客最多付 ★2 的價（D65），高星擺上架可能被散客便宜買走，這個取捨要看得到才算策略。
 */
export class ShelfCard {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private sig = '';

  constructor() {
    const t = document.createElement('template');
    t.innerHTML = `<div class="welcome shelfcard" hidden><div class="card">
      <h2>上架</h2>
      <p class="lead">散客最多只付 ★2 的價，而且會先拿最低星的那份。高星的留給常客（右邊「常客」看誰要什麼）。</p>
      <button data-a="shelfAll" class="all">全部上架（先上低星）</button>
      <p class="room"></p>
      <div class="slist"></div>
      <button data-a="closeShelf" class="ghost">關閉</button>
    </div></div>`;
    this.root = t.content.firstElementChild as HTMLElement;
    this.list = this.root.querySelector('.slist') as HTMLElement;
  }

  open() {
    this.root.hidden = false;
    this.sig = '';
  }

  close() {
    this.root.hidden = true;
  }

  sync(state: GameState) {
    if (this.root.hidden) return;
    const rows: { id: DessertId; star: Star }[] = [];
    for (const id of DESSERT_IDS) {
      for (const star of STARS) {
        if (stockOf(state, 'desserts', id, star) + stockOf(state, 'shelf', id, star) > 0) rows.push({ id, star });
      }
    }
    const sig = rows.map((r) => `${r.id}${r.star}`).join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.list.innerHTML = rows.length
        ? rows
            .map(({ id, star }) => `<div class="srow" data-id="${id}" data-star="${star}">
              ${artHtml(dessertArt(id))}
              <div class="txt"><b>${dessertName(id)}</b>${starsHtml(star, star, 'sm')}<small>散客付 ${walkInPrice(id, star)}・常客付 ${Math.round(dessertPrice(id, star) * REGULAR_BALANCE.tip)}</small></div>
              <span class="cnt">櫃 <b class="back">0</b>・架 <b class="front">0</b></span>
              <button class="one" data-a="shelfOne" data-arg="${id}:${star}">上架 1</button>
            </div>`)
            .join('')
        : '<p class="empty">成品櫃和展示架都是空的。到菜單開一盤甜點吧。</p>';
    }
    const room = BALANCE.bakery.shelfCap - shelfCount(state);
    (this.root.querySelector('.room') as HTMLElement).textContent = `展示架 ${shelfCount(state)}／${BALANCE.bakery.shelfCap}`;
    let anySpare = false;
    for (const row of this.list.querySelectorAll<HTMLElement>('.srow')) {
      const id = row.dataset.id as DessertId;
      const star = Number(row.dataset.star) as Star;
      (row.querySelector('.back') as HTMLElement).textContent = String(stockOf(state, 'desserts', id, star));
      (row.querySelector('.front') as HTMLElement).textContent = String(stockOf(state, 'shelf', id, star));
      const spare = spareDesserts(state, id)[star - 1] ?? 0;
      if (spare > 0) anySpare = true;
      (row.querySelector('.one') as HTMLButtonElement).disabled = spare <= 0 || room <= 0;
    }
    (this.root.querySelector('[data-a="shelfAll"]') as HTMLButtonElement).disabled = !anySpare || room <= 0;
  }
}
