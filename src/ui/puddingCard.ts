import { puddingSaleBlock } from '../game/actions';
import { BALANCE } from '../game/balance';
import { LIQUIDS, SPECIES, puddingPrice } from '../game/species';
import { careNeeded, growsCare, isEliteZone, nativeLiquids, residents, zoneCap } from '../game/stars';
import type { GameState, Pudding } from '../game/state';
import { MAX_STAR } from '../game/stock';
import { findZone, unlockedZones } from '../game/zones';
import { starsHtml } from './icons';
import { artHtml } from './shop';
import { INGREDIENT_ART } from './shopArt';

/**
 * 布丁卡（D70，2026-09-25）：點一隻布丁打開。星級、照顧進度、潛力、「搬到…」、升星藥、賣掉。
 *
 * 「為什麼沒在長」一定要講出來（D39 的教訓：規則全綠、玩家卻以為壞掉）：
 * 住量產區、精養區超收、已經到潛力上限——三種原因各一句人話。
 *
 * 結構（這是哪一隻、各區放不放得下）變了才重建；進度條與數字每次就地改，
 * 不然收集手在撿、布丁在泡澡，按鈕會在手指底下被換掉（D55 的教訓）。
 */
export class PuddingCard {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private id: string | null = null;
  private sig = '';

  constructor() {
    const t = document.createElement('template');
    t.innerHTML = `<div class="welcome pudcard" hidden><div class="card">
      <div class="pbody"></div>
      <button data-a="closePud" class="ghost">關閉</button>
    </div></div>`;
    this.root = t.content.firstElementChild as HTMLElement;
    this.body = this.root.querySelector('.pbody') as HTMLElement;
  }

  get openId(): string | null {
    return this.root.hidden ? null : this.id;
  }

  open(id: string) {
    this.id = id;
    this.sig = '';
    this.root.hidden = false;
  }

  close() {
    this.root.hidden = true;
    this.id = null;
  }

  sync(state: GameState) {
    if (this.root.hidden || !this.id) return;
    const p = state.puddings.find((x) => x.id === this.id);
    if (!p) {
      // 賣掉了（或生不出來那種邊界）：卡片跟著關，不要留一張指向不存在的布丁的卡
      this.close();
      return;
    }
    const zones = unlockedZones(state).filter((z) => z.id !== p.zone);
    const targets = zones.map((z) => ({ z, room: residents(state, z.id) < zoneCap(state, z.id) }));
    const sig = JSON.stringify([p.id, p.zone, p.species, p.star, p.potential, targets.map((t) => [t.z.id, t.z.mode, t.room]), state.items.starTonic > 0, isEliteZone(state, p.zone)]);
    if (sig !== this.sig) {
      this.sig = sig;
      this.body.innerHTML = this.html(state, p, targets);
    }
    this.paint(state, p);
  }

  private html(state: GameState, p: Pudding, targets: { z: { id: string; shortName: string; mode: string }; room: boolean }[]): string {
    const info = SPECIES[p.species];
    const home = findZone(state, p.zone);
    const native = nativeLiquids(p).map((l) => LIQUIDS[l].shortName).join('或');
    const mother = p.potential > 2 || p.star > 2 ? `媽媽 ★${p.potential - 1} → 我最高 ★${p.potential}` : `最高 ★${p.potential}`;
    const moves = targets.length
      ? targets
          .map(({ z, room }) => `<button class="mv" data-a="movePud" data-arg="${z.id}"${room ? '' : ' disabled'}>${z.shortName}${z.mode === 'elite' ? '<i class="tag">精養</i>' : ''}${room ? '' : '<small>滿了</small>'}</button>`)
          .join('')
      : '<span class="none">只有這一區（解鎖新櫥窗才搬得了家）</span>';
    const tonic = state.items.starTonic > 0 && isEliteZone(state, p.zone) && p.star < MAX_STAR
      ? `<button data-a="useTonic" class="tonic">用升星藥（剩 ${state.items.starTonic}）</button>`
      : '';
    return `
      <div class="phead">
        ${artHtml(INGREDIENT_ART[p.species])}
        <div class="txt"><h2>${info.name}</h2>${starsHtml(p.star, p.potential)}</div>
      </div>
      <p class="pline">${mother}・住在${home?.shortName ?? ''}${home?.mode === 'elite' ? '（精養）' : ''}</p>
      <div class="care"><div class="bar"><i></i></div><span class="ctext"></span></div>
      <p class="why"></p>
      <p class="native">本命液：${native}（泡一次 +${BALANCE.careNative}，其他 +${BALANCE.careBath}）</p>
      <div class="moves"><span class="lbl">搬到</span>${moves}</div>
      <div class="prow">${tonic}<button data-a="sellThisPud" class="sell">賣掉 ${puddingPrice(p.species)}</button></div>`;
  }

  private paint(state: GameState, p: Pudding) {
    const need = careNeeded(p.star);
    const grows = growsCare(state, p);
    const bar = this.body.querySelector('.care .bar > i') as HTMLElement | null;
    const ctext = this.body.querySelector('.ctext') as HTMLElement | null;
    const why = this.body.querySelector('.why') as HTMLElement | null;
    if (!bar || !ctext || !why) return;
    const atCap = p.star >= p.potential;
    const ratio = need && !atCap ? Math.min(1, p.care / need) : atCap ? 1 : 0;
    bar.style.width = `${Math.round(ratio * 100)}%`;
    bar.parentElement!.classList.toggle('full', atCap);
    ctext.textContent = atCap ? '已經最高' : `照顧 ${Math.floor(p.care)}／${need ?? '-'}`;
    let reason = '';
    if (atCap) reason = p.potential >= MAX_STAR ? '已經是 ★5 了。' : `牠最高只能到 ★${p.potential}。讓牠泡牛奶澡生寶寶，寶寶能長到 ★${Math.min(MAX_STAR, p.star + 1)}；升星藥可以突破上限。`;
    else if (!isEliteZone(state, p.zone)) reason = '住在量產區不會長星。搬到精養區，泡牠的本命液長得最快。';
    else if (!grows) reason = `精養區住了 ${residents(state, p.zone)} 隻，超過 ${BALANCE.eliteCapacity} 隻整區都不長；搬走幾隻就恢復。`;
    why.textContent = reason;
    why.hidden = reason === '';
    const sell = this.body.querySelector('[data-a="sellThisPud"]') as HTMLButtonElement | null;
    if (sell) {
      const block = puddingSaleBlock(state, p.id);
      sell.disabled = block !== null;
      sell.title = block ?? '';
    }
  }
}
