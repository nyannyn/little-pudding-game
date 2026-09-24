import { BALANCE } from '../game/balance';
import { clockAt, clockText, dayClock } from '../game/clock';
import {
  MAX_HEARTS,
  REGULARS,
  REGULAR_IDS,
  minStarFor,
  storyChapters,
  tasteText,
  type RegularId,
  type RegularState,
} from '../game/regulars';
import { REGULAR_STORIES } from '../game/regularStories';
import { dessertName } from '../game/recipes';
import { SPECIES } from '../game/species';
import type { GameState } from '../game/state';
import { heartsHtml, starsHtml } from './icons';
import { regularPortrait } from './regularPortrait';

/**
 * 常客名冊（D66／D70）：頭像、名字、口味、最低星級、心、下一次來店、上次結果、特別訂單、故事。
 * 沒解鎖的也列出來（剪影＋怎麼解鎖）：看得到下一個目標才有動力（D25 商店「灰掉不藏」的同一個理由）。
 *
 * 結構（誰解鎖了、幾顆心、幾章故事、有沒有特別訂單）變了才重建；來店時間這種會跳的字就地改。
 */
export class RegularsCard {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly story: HTMLElement;
  private sig = '';

  constructor() {
    const t = document.createElement('template');
    t.innerHTML = `<div class="welcome regcard" hidden><div class="card">
      <h2>常客</h2>
      <p class="lead">常客只買自己口味、而且不低於最低星級的甜點，付全額還給小費。買到一次＋1 心，越熟越挑。</p>
      <div class="rglist"></div>
      <div class="story" hidden>
        <h3></h3>
        <p class="body"></p>
        <button data-a="storyBack">回名冊</button>
      </div>
      <button data-a="closeRegulars" class="ghost">關閉</button>
    </div></div>`;
    this.root = t.content.firstElementChild as HTMLElement;
    this.list = this.root.querySelector('.rglist') as HTMLElement;
    this.story = this.root.querySelector('.story') as HTMLElement;
  }

  open() {
    this.root.hidden = false;
    this.story.hidden = true;
    this.list.hidden = false;
    this.sig = '';
  }

  close() {
    this.root.hidden = true;
  }

  /** 點開一章故事（呼叫端負責記成看過） */
  showStory(id: RegularId, chapter: number) {
    const ch = REGULAR_STORIES[id].chapters[chapter - 1];
    if (!ch) return;
    (this.story.querySelector('h3') as HTMLElement).textContent = `${REGULARS[id].name}・第 ${chapter} 章：${ch.title}`;
    (this.story.querySelector('.body') as HTMLElement).textContent = ch.body;
    this.story.hidden = false;
    this.list.hidden = true;
  }

  backToList() {
    this.story.hidden = true;
    this.list.hidden = false;
  }

  sync(state: GameState) {
    if (this.root.hidden) return;
    const sig = JSON.stringify(REGULAR_IDS.map((id) => {
      const r = state.regulars[id];
      return [r.unlocked, r.hearts, r.storySeen, r.lastResult?.at ?? 0, this.orderOf(state, id)?.id ?? ''];
    }));
    if (sig !== this.sig) {
      this.sig = sig;
      this.list.innerHTML = REGULAR_IDS.map((id) => this.row(state, id)).join('');
    }
    for (const row of this.list.querySelectorAll<HTMLElement>('.reg[data-open="1"]')) {
      const id = row.dataset.id as RegularId;
      (row.querySelector('.next') as HTMLElement).textContent = visitText(state, state.regulars[id]);
    }
  }

  private orderOf(state: GameState, id: RegularId) {
    return state.orders.find((o) => o.regularId === id && o.expiresAt > state.time);
  }

  private row(state: GameState, id: RegularId): string {
    const def = REGULARS[id];
    const r = state.regulars[id];
    const img = `<img class="pic" src="${regularPortrait(id)}" alt="" draggable="false">`;
    if (!r.unlocked) {
      return `<div class="reg locked" data-id="${id}">${img}<div class="txt"><b>？？？</b><small>${unlockText(id)}</small></div></div>`;
    }
    const min = minStarFor(id, r.hearts);
    const chapters = storyChapters(r.hearts);
    const stories = [1, 2, 3]
      .map((n) => (n <= chapters ? `<button class="ch${n > r.storySeen ? ' new' : ''}" data-a="readStory" data-arg="${id}:${n}">第 ${n} 章</button>` : ''))
      .join('');
    const o = this.orderOf(state, id);
    const order = o
      ? `<p class="ord">特別訂單：${SPECIES[o.species].dessert} ×${o.qty}（★${o.star ?? 1} 以上）・報酬 ${o.price}・在「預訂單」交</p>`
      : '';
    const sig = r.hearts >= MAX_HEARTS ? `<p class="sig">招牌甜點：${REGULAR_STORIES[id].signature}</p>` : '';
    return `<div class="reg" data-id="${id}" data-open="1">
      ${img}
      <div class="txt">
        <div class="nm"><b>${def.name}</b>${heartsHtml(r.hearts, MAX_HEARTS)}</div>
        <small>${tasteText(def.taste)}・至少 ${starsHtml(min, min, 'sm')}</small>
        <small class="next"></small>
        <small class="last">${lastText(state, id)}</small>
        ${order}${sig}
        ${stories ? `<div class="chs">${stories}</div>` : ''}
      </div>
    </div>`;
  }
}

function unlockText(id: RegularId): string {
  const u = REGULARS[id].unlock;
  if (u.kind === 'open') return '甜點店開張（買齊一道甜點的整條線）就會來';
  if (u.kind === 'allele') return `養出${SPECIES[u.allele].shortName}系的布丁、店面人氣 Lv${u.fame}`;
  return `${REGULARS[u.of].name} ♥8 的時候會介紹`;
}

/** 下一次來店：前一天打烊時才公布幾點（D66），之前只講第幾天 */
export function visitText(state: GameState, r: RegularState): string {
  if (!r.unlocked || r.nextVisitAt <= 0) return '';
  const c = dayClock(state);
  const v = clockAt(state, r.nextVisitAt);
  if (v.day === c.day) return r.nextVisitAt >= state.time ? `今天 ${clockText(v.hour)} 會來` : '';
  if (v.day === c.day + 1 && c.hour >= BALANCE.bakery.closeHour) return `明天 ${clockText(v.hour)} 會來`;
  return `第 ${v.day} 天會來（${v.day - c.day} 天後）`;
}

function lastText(state: GameState, id: RegularId): string {
  const r = state.regulars[id].lastResult;
  if (!r) return '還沒來過';
  if (r.bought && r.dessert && r.star) {
    const gift = r.gift === 'tonic' ? '，還送了一瓶升星藥' : r.gift === 'ingredients' ? '，還送了幾份原料' : '';
    return `上次（第 ${r.day} 天）買了 ★${r.star} ${dessertName(r.dessert)}，付 ${r.coins}${gift}`;
  }
  const t = REGULARS[id].taste;
  const goods = t.kind === 'species' ? SPECIES[t.species].dessert : `${SPECIES[t.allele].shortName}系甜點`;
  return `上次（第 ${r.day} 天）撲空：架上沒有 ★${minStarFor(id, state.regulars[id].hearts)} 以上的${goods}`;
}
