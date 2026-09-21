/**
 * 音效。D8 只要一個「啪嘰」。
 *
 * 用 WebAudio 現場合成，不放 mp3：這個聲音是一段 60 ms 的濾波雜訊，
 * 合成出來比我能手寫的音檔準，而且資產量是 0（預算只有 3 MB）。
 *
 * iOS 的 AudioContext 一定要在**使用者手勢裡**才解得開，
 * 所以 `unlock()` 掛在第一次 pointerdown/touchend 上。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private unlocked = false;
  muted = false;

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

  async unlock(): Promise<boolean> {
    if (this.unlocked) return true;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = this.ctx ?? new Ctor();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.noise = this.makeNoise(this.ctx);
      this.unlocked = this.ctx.state === 'running';
      return this.unlocked;
    } catch {
      return false;
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 啪嘰：短雜訊（拍擊）＋一個下滑的低音（黏稠感） */
  splat(volume = 0.5) {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || this.muted || !this.noise) return;
    const t = ctx.currentTime;

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
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || this.muted) return;
    const t = ctx.currentTime;
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
}
