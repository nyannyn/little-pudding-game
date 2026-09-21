/**
 * HUD 沒遮住的那一段畫面（CSS px）。
 * 上方資源列與下方動作列都是固定定位的 HTML，3D 畫面被它們蓋掉一截；
 * 鏡頭要把「畫面中心」放在這一段的中心，布丁才不會貼著動作列的上緣、甚至被引導泡泡蓋住。
 * 引導泡泡與 toast 會出現又消失，不納入——鏡頭跟著它們跳會比被蓋住更糟。
 */
export interface VisibleBand {
  top: number;
  bottom: number;
}

export function measureVisibleBand(viewportHeight: number): VisibleBand {
  const topbar = document.querySelector('.hud .topbar')?.getBoundingClientRect();
  const dock = document.querySelector('.hud .dock')?.getBoundingClientRect();
  const top = topbar ? Math.max(0, topbar.bottom) : 0;
  const bottom = dock && dock.height > 0 ? Math.min(viewportHeight, dock.top) : viewportHeight;
  return bottom > top ? { top, bottom } : { top: 0, bottom: viewportHeight };
}

/** 要把畫面中心往上挪幾 px 才會落在可見段的中心（正值＝場景往上移） */
export function viewOffsetY(viewportHeight: number, band: VisibleBand): number {
  return Math.round(viewportHeight / 2 - (band.top + band.bottom) / 2);
}
