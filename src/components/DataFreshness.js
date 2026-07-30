import React, { useState } from "react";
import "./DataFreshness.css";
import {
  formatCount,
  formatDateTime,
  formatElapsed,
  summarizeUpdates,
} from "../utils/updatedAtApi";

/**
 * 各シートのデータがいつ時点のものかを示す帯。
 *
 * メニューを押し下げないよう、既定は1行の要約だけ。タップで内訳を開く。
 * ただし「更新日時」シートは同期が失敗すると日時が進まず状態だけ NG になり、
 * 古い日時が黙って表示され続けるのが一番まずいので、
 * 失敗しているときは畳まず最初から開いて見せる。
 *
 * props:
 *   rows    : fetchSheetUpdates() の結果
 *   status  : "loading" | "ready" | "empty" | "error"
 *   onRetry : 再取得（省略可）
 */

const DataFreshness = ({ rows = [], status = "loading", onRetry }) => {
  const [opened, setOpened] = useState(null); // null = 利用者はまだ触っていない

  const now = new Date();
  const summary = summarizeUpdates(rows, now);

  if (status === "loading") {
    return (
      <div className="freshness freshness--plain">
        <span className="freshness__line">データの更新状況を確認しています...</span>
      </div>
    );
  }

  if (status === "empty" || status === "error") {
    return (
      <div className="freshness freshness--plain">
        <span className="freshness__line">
          {status === "empty"
            ? "ただいまデータ更新中の可能性があります"
            : "更新状況を取得できませんでした"}
        </span>
        {onRetry && (
          <button type="button" className="freshness__retry" onClick={onRetry}>
            再確認
          </button>
        )}
      </div>
    );
  }

  // 失敗時は既定で開く。利用者が開閉したらその操作を優先する
  const expanded = opened === null ? summary.level === "error" : opened;

  // 「全シートがこの時刻以降のデータ」と言えるよう、最も古い時刻を代表に出す。
  //
  // 表示は「最新です」ではなく「〇時点」にとどめる。
  // アプリが分かるのはシートに書き込めた時刻と同期の成否だけで、
  // Salesforce 側にそれより新しいデータがあるかどうかは知りようがない。
  // 断定できるのは「更新が止まっている」「同期が失敗した」側だけ。
  const base = summary.oldest;
  const headline =
    summary.level === "error"
      ? `${summary.failed.map((row) => row.name).join("・")} が更新できていません`
      : summary.level === "warn"
      ? "10時間以上更新されていません"
      : "";

  return (
    <div className={`freshness freshness--${summary.level}`}>
      <button
        type="button"
        className="freshness__bar"
        onClick={() => setOpened(!expanded)}
        aria-expanded={expanded}
      >
        <span className="freshness__icon" aria-hidden="true">
          {summary.level === "ok" ? "i" : "！"}
        </span>
        <span className="freshness__line">
          {headline && <span className="freshness__headline">{headline}</span>}
          <span className="freshness__stamp">
            データは <strong>{formatDateTime(base)}</strong> 時点
            {base && `（${formatElapsed(base, now)}）`}
          </span>
        </span>
        <span className={`freshness__caret${expanded ? " is-open" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {expanded && (
        <div className="freshness__detail">
          {summary.level === "error" && (
            <p className="freshness__alert" role="alert">
              下記の日時より後のデータは反映されていません。管理者へご連絡ください。
            </p>
          )}
          {summary.level === "warn" && (
            <p className="freshness__alert" role="alert">
              通常は8時間以内に更新されます。管理者へご連絡ください。
            </p>
          )}

          <ul className="freshness__list">
            {rows.map((row) => (
              <li
                key={row.name}
                className={`freshness__item${row.ok ? "" : " freshness__item--ng"}`}
              >
                <div className="freshness__item-head">
                  <span className="freshness__name">{row.name}</span>
                  {!row.ok && <span className="freshness__badge">更新失敗</span>}
                </div>
                <div className="freshness__meta">
                  <span className="freshness__time">
                    {formatDateTime(row.updatedAt)} 時点
                  </span>
                  {row.count !== null && (
                    <span className="freshness__count">{formatCount(row.count)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <p className="freshness__note">
            上記は連携ツールがデータを書き込んだ時刻です。
            <strong>それ以降に Salesforce 側で行われた変更は含まれません。</strong>
            <br />
            データ連携は <strong>毎日 0時・8時・12時・16時・20時</strong>（所要3分ほど）。
            更新中は検索結果が正しく表示されないことがあります。
          </p>
        </div>
      )}
    </div>
  );
};

export default DataFreshness;
