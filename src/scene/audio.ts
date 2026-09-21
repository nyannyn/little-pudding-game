/**
 * 音效。D8 只要一個「啪嘰」；之後加了收錢與倒液體。
 *
 * 用 WebAudio 現場合成，不放 mp3：這些聲音都是幾十到幾百毫秒的濾波雜訊加正弦，
 * 合成出來比我能手寫的音檔準，而且資產量是 0（預算只有 3 MB）。
 *
 * iOS 的 AudioContext 一定要在**使用者手勢裡**才解得開，
 * 所以 `unlock()` 掛在第一次 pointerdown/touchend 上。
 * 掛的目標要是 `window`：教學的第一個動作是按 HUD 上的「倒焦糖」，那是 canvas 外面的
 * DOM button，只掛 canvas 會讓玩家做的第一個動作正好是唯一解不開聲音的那個。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private unlocked = false;
  muted = false;
  /** 每種音效實際排進 AudioContext 的次數；e2e 用它斷言「按下去真的有播」（截圖證不了聲音） */
  readonly played = { splat: 0, coin: 0, pour: 0 };

  /** 掛在第一次觸控上；重複呼叫無害 */
  attachUnlock(target: EventTarget = window) {
    const handler = () => {
      void this.unlock();
      target.removeEventListener('pointerdown', handler);
      target.removeEventListener('touchend', handler);
    };
    target.addEventListener('pointerdown', handler, { once: false });
    target.addEventListener('touchend', handler, { once: false });
  }

  get isUnlocked() {
    return this.unlocked;
  }

  async unlock(): Promise<boolean> {
    if (this.unlocked) return true;
    try {
      const ctx = this.ensureCtx();
      if (!ctx) return false;
      if (ctx.state === 'suspended') await ctx.resume();
      this.unlocked = ctx.state === 'running';
      return this.unlocked;
    } catch {
      return false;
    }
  }

  /** 同步建 context（不等 resume）；在手勢裡呼叫時 iOS 會在幾毫秒內把它轉成 running */
  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.noise = this.makeNoise(this.ctx);
    this.ctx.addEventListener('statechange', () => {
      this.unlocked = this.ctx?.state === 'running';
    });
    return this.ctx;
  }

  /**
   * 可以播的 context。模擬層事件（啪嘰、收錢）不在手勢裡，context 還沒 running 就不排節點——
   * 排了會在解鎖那一刻全部一起炸出來。`gesture=true` 是玩家按鈕觸發的音：同步 resume 後照樣排，
   * 不等 `unlock()` 的 promise（那會讓第一次按「倒焦糖」永遠靜音）。
   */
  private live(gesture = false): AudioContext | null {
    if (this.muted) return null;
    const ctx = gesture ? this.ensureCtx() : this.ctx;
    if (!ctx || !this.noise) return null;
    if (ctx.state === 'running') {
      this.unlocked = true;
      return ctx;
    }
    if (!gesture) return null;
    void ctx.resume().then(() => { this.unlocked = ctx.state === 'running'; }).catch(() => undefined);
    return ctx;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    // 2 秒：倒液體那條要撐到 1.2 秒以上，啪嘰只取開頭
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 啪嘰：短雜訊（拍擊）＋一個下滑的低音（黏稠感） */
  splat(volume = 0.5) {
    const ctx = this.live();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    this.played.splat++;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.12);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(volume * 0.45, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /** 收錢／成交的小提示音 */
  coin(volume = 0.32) {
    const ctx = this.live();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.played.coin++;
    for (const [i, f] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.06);
      g.gain.linearRampToValueAtTime(volume, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.16);
      osc.connect(g).connect(ctx.destination);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.18);
    }
  }

  /**
   * 倒液體。`thickness` 0＝牛奶那種稀的，1＝熱焦糖那種稠的；`duration` 是水流持續的秒數；
   * `delay` 讓聲音等壺進場到位才開始（跟 `PourView` 的時間表對齊）。
   *
   * 兩層疊起來：
   * ① 帶通雜訊＝水流沖進盆裡的「沙——」，中心頻率隨時間往上爬（容器越滿共鳴越高，
   *    這是耳朵判斷「在倒東西」最主要的線索）；稠的液體整體低半個八度、頻寬窄、慢一點爬。
   * ② 幾顆下滑的正弦「咕嚕」＝瓶口進氣的聲音，稠的液體咕嚕大聲、間隔長；稀的小聲密集。
   */
  pour(thickness: number, duration: number, volume = 0.5, gesture = false, delay = 0) {
    const ctx = this.live(gesture);
    if (!ctx || !this.noise) return;
    const t0 = ctx.currentTime + Math.max(0, delay);
    const k = Math.min(1, Math.max(0, thickness));
    const d = Math.max(0.3, duration);
    this.played.pour++;

    // ① 水流
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const f0 = 520 - 260 * k, f1 = 1500 - 800 * k;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(f1, t0 + d);
    bp.Q.value = 1.4 + 1.6 * k;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200 - 1600 * k;
    // 水流的粗細：低頻 LFO 抖動音量，讓它不是平的「嘶」
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 9 - 4 * k;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = volume * 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(volume * (0.9 - 0.2 * k), t0 + 0.08);
    g.gain.setValueAtTime(volume * (0.9 - 0.2 * k), t0 + d - 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.08);
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(bp).connect(lp).connect(g).connect(ctx.destination);
    lfo.start(t0);
    lfo.stop(t0 + d + 0.1);
    src.start(t0);
    src.stop(t0 + d + 0.1);

    // ② 咕嚕：稠的 3 顆、稀的 5 顆，落在水流中段
    const n = k > 0.5 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const at = t0 + 0.12 + ((i + Math.random() * 0.6) / n) * (d - 0.2);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const base = 150 + 70 * (1 - k) + Math.random() * 40;
      osc.frequency.setValueAtTime(base * 1.8, at);
      osc.frequency.exponentialRampToValueAtTime(base * 0.7, at + 0.09 + 0.05 * k);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, at);
      og.gain.exponentialRampToValueAtTime(volume * (0.22 + 0.25 * k), at + 0.015);
      og.gain.exponentialRampToValueAtTime(0.0001, at + 0.12 + 0.06 * k);
      osc.connect(og).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    }
  }
}
