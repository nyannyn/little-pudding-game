import { migrate, type GameState } from './state';

/**
 * 存檔碼：把整份存檔變成一串可以複製貼上的文字。
 *
 * 為什麼要有：localStorage 是瀏覽器說了算的東西——無痕、清網站資料、
 * Safari 的七天清除、換一支手機，任何一個都會讓進度整份消失，而且事前不會通知。
 * 這串碼是玩家唯一帶得走的備份，不用帳號也不用後端。
 *
 * 格式 `LPG1.<base64url 的存檔 JSON>.<檢查碼>`：
 * 檢查碼不是防竄改（玩家想改自己的存檔隨他），是防「複製時少了一截」——
 * 貼進來的碼缺一段時要當場說「這串碼不完整」，不能靜默吃下半份資料開一個殘缺的農場。
 */
const PREFIX = 'LPG1';

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  // 一次一個位元組：String.fromCharCode(...bytes) 在幾 KB 的存檔上會炸掉呼叫堆疊
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string | null {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** FNV-1a，8 位十六進位。只用來抓「碼被截斷／貼漏了」 */
function checksum(json: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function exportCode(state: GameState): string {
  const json = JSON.stringify(state);
  return `${PREFIX}.${toBase64Url(json)}.${checksum(json)}`;
}

/**
 * 解析存檔碼。壞碼一律回 `null`，不丟例外也不回半份狀態。
 * 舊版本的碼照樣吃得下：解出來的東西一律過 `migrate()`，跟讀 localStorage 走同一條補值路徑。
 */
export function importCode(code: string): GameState | null {
  // 玩家從備忘錄貼過來常會夾帶換行與空白
  const parts = code.replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, body, sum] = parts as [string, string, string];

  const json = fromBase64Url(body);
  if (json === null || checksum(json) !== sum) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  // 沒有布丁的存檔＝空農場，還原它跟開新檔沒兩樣，卻會把現有進度蓋掉
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { puddings?: unknown }).puddings)) {
    return null;
  }
  if ((parsed as { puddings: unknown[] }).puddings.length === 0) return null;

  return migrate(parsed);
}
