// 「更新日時」シートから各シートの鮮度を読む。
// 仕様は docs/アプリ開発者向け_連携仕様.md（同期ツール側と取り決め済み）。
//
//   A: シート名 / B: 最終更新日時 / C: 件数 / D: 状態(OK|NG) / E: 所要秒
//   2行目以降がデータ。列の順序と意味は変更されない約束になっている。
//
// 同期は「全消去 → 全件書き込み」方式のため、実行中は数秒〜16秒ほど
// シートが空になる。0件は異常ではなく「今は同期中」のサインなので、
// 少し待って読み直し、それでも0件なら本当の異常として扱う。

import { clearSheetCache, fetchSheetValues, rememberSheetStamps } from "./sheetsApi";

const RANGE_UPDATED_AT = "更新日時!A1:E";

const EMPTY_RETRY_LIMIT = 3; // 初回を含む試行回数
const EMPTY_RETRY_WAIT_MS = 5000; // 5秒×2回待てば最長16.3秒をカバーできる

/** 同期が止まっていると判断するまでの猶予。
 *  同期の最大間隔は8時間（0:00〜8:00）なので、それを超えたら遅延とみなす。
 *  同期ツール側の死活監視も10時間で警報を出す。 */
const STALE_MS = 10 * 60 * 60 * 1000;

/** アプリが実際に読んでいるシートだけを、利用頻度の高い順に表示する。
 *  「更新日時」シートには 案件_FY2025 の行もあるが、アプリからは参照して
 *  いないため出さない（利用者には関係のない情報になるため）。 */
const DISPLAY_ORDER = ["稼働中案件", "パートナー情報", "離脱パートナー"];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "2026-07-30 16:46:12" を Date にする。
 * iOS Safari は new Date("2026-07-30 16:46:12") を解釈できないため自前で分解する。
 * 書式が変わっても落ちないよう、区切りと秒は緩めに受ける。
 */
export const parseSheetDateTime = (text) => {
  const matched = String(text ?? "")
    .trim()
    .match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!matched) return null;

  const [year, month, day, hour, minute, second] = matched
    .slice(1)
    .map((part) => Number(part ?? 0));
  const date = new Date(year, month - 1, day, hour, minute, second || 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toCount = (text) => {
  const value = Number(String(text ?? "").replace(/,/g, "").trim());
  return Number.isFinite(value) ? value : null;
};

const parseRow = (row = []) => {
  const name = String(row[0] ?? "").trim();
  if (!name) return null;

  const status = String(row[3] ?? "").trim().toUpperCase();
  return {
    name,
    updatedAt: parseSheetDateTime(row[1]),
    count: toCount(row[2]),
    // 状態が空欄でも「異常なし」に倒さないよう、NG以外だけを成功とみなす
    ok: status !== "NG",
    status: status || "OK",
  };
};

const parseUpdates = (values) => {
  const rows = (values || [])
    .slice(1) // 1行目はヘッダ
    .map(parseRow)
    .filter(Boolean);

  // アプリが使うシートだけを、DISPLAY_ORDER の並びで返す
  return DISPLAY_ORDER.map((name) => rows.find((row) => row.name === name)).filter(
    Boolean
  );
};

/**
 * 各シートの更新状況を取得する。
 * 同期中で0件だった場合は待って読み直す（最大 EMPTY_RETRY_LIMIT 回）。
 */
export async function fetchSheetUpdates({ force = false } = {}) {
  for (let attempt = 1; attempt <= EMPTY_RETRY_LIMIT; attempt++) {
    // 2回目以降は同期の完了を見に行くので、キャッシュを迂回する
    const values = await fetchSheetValues(RANGE_UPDATED_AT, {
      force: force || attempt > 1,
    });
    const rows = parseUpdates(values);
    if (rows.length) {
      // 読んだ日時はキャッシュの有効判定にも使う
      rememberSheetStamps(rows);
      return rows;
    }

    if (attempt < EMPTY_RETRY_LIMIT) await wait(EMPTY_RETRY_WAIT_MS);
  }
  return [];
}

/**
 * 「引いて更新」から呼ぶ。
 *
 * いきなり force で取り直すと、シートが1行も変わっていなくても
 * 数MBのダウンロードが走る。先に「更新日時」シート（数行）だけを読み、
 * 日時が動いたシートのキャッシュだけを捨てる。
 * 呼び出し側はこの後 force を付けずに読み直せば、
 * 変わったシートだけが通信され、変わっていないシートはキャッシュで済む。
 */
export async function syncSheetCaches() {
  try {
    await fetchSheetUpdates({ force: true });
  } catch (error) {
    // 日時が読めないと変化を判断できない。安全側に倒して従来どおり全件取り直す
    console.error("更新日時を確認できませんでした:", error);
    clearSheetCache();
  }
}

/**
 * 全体としてどう見せるかを決める。
 *   ok    … 全シート成功で、更新も止まっていない
 *   warn  … 成功しているが最終更新が古い（同期が動いていない疑い）
 *   error … NGのシートがある（＝そのシートは前回成功時のデータのまま）
 */
export const summarizeUpdates = (rows, now = new Date()) => {
  if (!rows.length) return { level: "unknown", failed: [], latest: null, oldest: null };

  const failed = rows.filter((row) => !row.ok);
  const times = rows
    .map((row) => row.updatedAt)
    .filter(Boolean)
    .map((date) => date.getTime());

  const latest = times.length ? new Date(Math.max(...times)) : null;
  const oldest = times.length ? new Date(Math.min(...times)) : null;
  const stale = oldest ? now.getTime() - oldest.getTime() > STALE_MS : false;

  return {
    level: failed.length ? "error" : stale ? "warn" : "ok",
    failed,
    latest,
    oldest,
    stale,
  };
};

/** 「2026-07-30 16:46」 */
export const formatDateTime = (date) => {
  if (!date) return "不明";
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
};

/** 「約2時間前」。端末の時計がずれて未来になっても破綻させない。 */
export const formatElapsed = (date, now = new Date()) => {
  if (!date) return "";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `約${minutes}分前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `約${hours}時間前`;
  return `約${Math.floor(hours / 24)}日前`;
};

/** 「5,404件」 */
export const formatCount = (count) =>
  count === null ? "" : `${count.toLocaleString("ja-JP")}件`;
