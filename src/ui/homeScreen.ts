/**
 * 「加到主畫面」提示。
 *
 * 為什麼要有：iOS 13.4 起 Safari 會在「七天沒回來互動」之後清掉整站的
 * script-writable storage（localStorage／IndexedDB／SW 註冊都算），玩家的存檔就這樣沒了。
 * 加到主畫面的 web app 不在 Safari 那個計時器裡（自己的使用日計數），所以這是
 * Safari 分頁階段唯一不用蓋後端就能守住進度的做法。
 * （後期用 Expo WebView 包 App 之後不吃這條規則，這個提示到時候可以拿掉。）
 */

const DISMISS_KEY = 'lpg.a2hs.off';

function dismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // 讀不到就當作沒看過，提示照顯示
  }
}

export function dismissHomeScreenTip(): void {
  try {
    globalThis.localStorage?.setItem(DISMISS_KEY, '1');
  } catch {
    /* 存不進去就這一輪不再顯示，下次重開會再出現 */
  }
}

/** 只有「在 iOS Safari 分頁裡開、而且還沒加到主畫面」才提示 */
export function shouldSuggestHomeScreen(): boolean {
  const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
  if (!nav || dismissed()) return false;

  // iPadOS 13 起 UA 自稱 Macintosh，要用觸控點數補判
  const ua = nav.userAgent ?? '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && nav.maxTouchPoints > 1);
  if (!ios) return false;

  const standalone = nav.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
  return !standalone;
}
