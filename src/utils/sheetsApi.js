// Google Sheets 取得の共通レイヤー
//  - 認証切れ（401/403・トークン無し）を SheetAuthError として明示的に扱う
//  - 同一シートの再ダウンロードを防ぐキャッシュ（ページ間移動で効く）
//  - 同時に走った同一リクエストは1本にまとめる

import axios from "axios";

const DEFAULT_SPREADSHEET_ID = process.env.REACT_APP_SPREADSHEET_ID;
const SHEETS_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets";

/** 認証切れ（トークン失効・未ログイン・権限なし）を表すエラー */
export class SheetAuthError extends Error {
  constructor(message = "Googleの認証が切れています。再ログインしてください。") {
    super(message);
    this.name = "SheetAuthError";
    this.isAuthError = true;
  }
}

export const getToken = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
};

/** 認証情報のみ削除する（お気に入り等のユーザー設定は残す） */
export const clearSession = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
  localStorage.removeItem("userEmail");
  localStorage.removeItem("userName");
};

export const isAuthError = (error) =>
  Boolean(error?.isAuthError) || [401, 403].includes(error?.response?.status);

/* ===== キャッシュの有効期間 ===== */
// Salesforce連携は毎日 8/12/16/20/24 時に実行される。
// 直近の連携時刻をまたいだらキャッシュを破棄し、同じ連携世代の間は再利用する。
const SYNC_HOURS = [0, 8, 12, 16, 20];

export const currentSyncWindow = (now = new Date()) => {
  const hour = SYNC_HOURS.filter((h) => h <= now.getHours()).pop() ?? 0;
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}T${hour}`;
};

const valuesCache = new Map(); // cacheKey -> { window, stamp, values }
const rowsCache = new Map(); // cacheKey -> { window, stamp, rows }
const inflight = new Map(); // cacheKey -> Promise

/* ===== シートごとの最終更新日時 =====
   「更新日時」シート（同期ツールが書き込む）で分かる各シートの最終更新時刻。
   連携世代だけで判断すると、同期が動いていない・失敗した場合でも
   数MBのシートを取り直してしまう。中身が変わっていない確証があるなら
   通信しないよう、日時が一致する間はキャッシュを使い続ける。
   値は updatedAtApi 側から預かる（このモジュールは表示を知らない）。 */
const sheetStamps = new Map(); // シート名 -> 最終更新日時(ms)
let stampsWindow = null; // 日時を読んだ時点の連携世代

/** "パートナー情報!A1:ZZ" -> "パートナー情報" */
export const sheetNameOf = (range) =>
  String(range ?? "")
    .split("!")[0]
    .replace(/^'(.*)'$/, "$1")
    .trim();

/** 「更新日時」シートの読み取り結果を控える */
export const rememberSheetStamps = (entries = []) => {
  stampsWindow = currentSyncWindow();
  entries.forEach(({ name, updatedAt }) => {
    if (name && updatedAt) sheetStamps.set(name, updatedAt.getTime());
  });
};

// 控えた日時が古い連携世代のものなら、判断材料として使わない
const stampsUsable = () => stampsWindow === currentSyncWindow();

const stampOf = (range) => {
  if (!stampsUsable()) return null;
  return sheetStamps.get(sheetNameOf(range)) ?? null;
};

/** キャッシュを破棄する（range 省略時は全件） */
export const clearSheetCache = (range) => {
  if (!range) {
    valuesCache.clear();
    rowsCache.clear();
    sheetStamps.clear();
    stampsWindow = null;
    return;
  }
  [valuesCache, rowsCache].forEach((store) => {
    Array.from(store.keys())
      .filter((key) => key.includes(`!${range}`))
      .forEach((key) => store.delete(key));
  });
};

const readCache = (store, cacheKey, field, range) => {
  const hit = store.get(cacheKey);
  if (!hit) return undefined;

  const drop = () => {
    store.delete(cacheKey);
    return undefined;
  };

  const stamp = stampOf(range);
  if (stamp !== null) {
    // 最終更新日時が分かる場合はそれが最優先。連携世代をまたいでいても、
    // シートが書き換わっていなければ取り直す理由がない。
    if (hit.stamp === stamp) return hit[field];
    // 日時が分かるのに控えが無い（日時を知る前に取ったデータ）は検証できない
    return drop();
  }

  // 「更新日時」に載らないシート（都道府県マスタなど）は従来どおり連携世代で判断
  if (hit.window === currentSyncWindow()) return hit[field];
  return drop();
};

/**
 * シートの生の値（2次元配列）を取得する。
 * @param {string} range 例: "パートナー情報!A1:ZZ"
 */
export async function fetchSheetValues(
  range,
  { force = false, spreadsheetId = DEFAULT_SPREADSHEET_ID } = {}
) {
  const cacheKey = `${spreadsheetId}!${range}`;

  if (!force) {
    const cached = readCache(valuesCache, cacheKey, "values", range);
    if (cached) return cached;
    const pending = inflight.get(cacheKey);
    if (pending) return pending;
  }

  const token = getToken();
  if (!token) {
    throw new SheetAuthError("ログイン情報が見つかりません。再ログインしてください。");
  }

  const request = (async () => {
    try {
      const url = `${SHEETS_ENDPOINT}/${spreadsheetId}/values/${range}`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const values = res.data?.values || [];
      // 同期は「全消去→全件書き込み」方式で、実行中は数秒〜16秒シートが空になる。
      // その一瞬を掴んだ結果を寝かせると連携世代が変わるまで空のままになるため、
      // 0件はキャッシュしない（次の取得でやり直せるようにする）。
      if (values.length) {
        valuesCache.set(cacheKey, {
          window: currentSyncWindow(),
          stamp: stampOf(range),
          values,
        });
      }
      return values;
    } catch (error) {
      if (isAuthError(error)) throw new SheetAuthError();
      throw error;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, request);
  return request;
}

// ヘッダ名の正規化（全角スペース→半角、trim、空白除去）
const normalizeHeaderKey = (value) =>
  String(value || "")
    .replace(/　/g, " ")
    .trim()
    .replace(/\s+/g, "");

const buildRows = (values, normalizeKeys) => {
  const header = values[0] || [];
  const headerLen = header.length;
  if (!headerLen) return [];

  return values.slice(1).map((row) => {
    const obj = {};
    for (let i = 0; i < headerLen; i++) {
      const key = header[i] ?? "";
      // 行末が切り詰められている場合も空文字で埋める
      const value = row[i] ?? "";
      obj[key] = value;
      if (normalizeKeys) {
        const normalized = normalizeHeaderKey(key);
        if (normalized && normalized !== key) obj[normalized] = value;
      }
    }
    return obj;
  });
};

/**
 * 1行目をヘッダとして、シートをオブジェクト配列で取得する。
 * @param {string} range 例: "稼働中案件!A1:ZZ"
 * @param {boolean} [options.normalizeKeys] ヘッダに空白が混じるシート向けに正規化キーも併記する
 */
export async function fetchSheetRows(
  range,
  { force = false, normalizeKeys = false, spreadsheetId = DEFAULT_SPREADSHEET_ID } = {}
) {
  const cacheKey = `${spreadsheetId}!${range}!${normalizeKeys ? "norm" : "raw"}`;

  if (!force) {
    const cached = readCache(rowsCache, cacheKey, "rows", range);
    if (cached) return cached;
  }

  const values = await fetchSheetValues(range, { force, spreadsheetId });
  const rows = buildRows(values, normalizeKeys);
  // 同期中に読んだ0件を寝かせない（理由は fetchSheetValues 側のコメント）
  if (rows.length) {
    rowsCache.set(cacheKey, {
      window: currentSyncWindow(),
      stamp: stampOf(range),
      rows,
    });
  }
  return rows;
}
