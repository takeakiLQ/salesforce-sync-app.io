// 曜日×時間帯ごとに、稼働している案件（またはパートナー）の数を濃淡で見せる。
// パートナー確保の検討向けなので、多いマスほど濃くして混んでいる時間帯を目立たせる。
//
// 数え方（どの案件をどのマスに入れるか）は呼び出し側が決める。ここは描くだけ。
//
// props:
//   grid        : [曜日7][時24] の { count, partners, hours }
//   metric      : "count" | "partners"
//   onMetricChange
//   selected    : { day, hour } | null  クリックで選んでいるマス
//   onSelect    : (day, hour) => void   マスのクリック
//   total       : 集計の元にした案件数
//   excluded    : 時間帯を出せず数えていない案件数（曜日・時刻が無い、祝日のみ）
//   transpose   : true なら行＝時、列＝曜日（スマホ向け）

import React, { useState } from "react";
import "./WorkHeatmap.css";

export const HEAT_DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const METRICS = [
  { key: "count", label: "案件数", unit: "件" },
  { key: "partners", label: "パートナー数", unit: "パートナー" },
];

/* ===== 色 =====
   薄いティール → 濃い紺。0件は灰色にして「少ない」と「無い」を見分ける。
   凡例の帯（CSS の .wh__legend-bar）も同じ3色で描く。 */
const COLOR_STOPS = [
  [0, [211, 235, 234]], // #d3ebea
  [0.5, [27, 138, 140]], // #1b8a8c
  [1, [11, 49, 66]], // #0b3142
];

const mix = (ratio) => {
  const upper = COLOR_STOPS.findIndex(([at]) => at >= ratio);
  if (upper <= 0) return COLOR_STOPS[0][1];
  const [fromAt, from] = COLOR_STOPS[upper - 1];
  const [toAt, to] = COLOR_STOPS[upper];
  const t = (ratio - fromAt) / (toAt - fromAt);
  return from.map((value, i) => Math.round(value + (to[i] - value) * t));
};

const cellStyle = (value, max) => {
  if (!value || !max) return undefined;
  const ratio = value / max;
  return {
    backgroundColor: `rgb(${mix(ratio).join(",")})`,
    color: ratio > 0.45 ? "#fff" : "#0b3142",
  };
};

const formatHours = (hours) => `${Number(hours.toFixed(1)).toLocaleString()}h`;

const slotRange = (day, hour) =>
  `${HEAT_DAYS[day]}曜 ${hour}:00〜${hour + 1}:00`;

const WorkHeatmap = ({
  grid,
  metric,
  onMetricChange,
  selected,
  onSelect,
  total,
  excluded,
  transpose,
}) => {
  // マウスを乗せているマス。内容を上の1行に出す（マスには数字しか書かないため）
  const [hovered, setHovered] = useState(null);

  const { label: metricLabel, unit } = METRICS.find((m) => m.key === metric) || METRICS[0];
  const valueOf = (day, hour) => grid[day][hour][metric];

  // 最大値とピーク。同じ値のマスが複数あれば、曜日・時刻の早いものを代表にする
  let max = 0;
  let peak = null;
  let peakTies = 0;
  HEAT_DAYS.forEach((_, day) =>
    HOURS.forEach((hour) => {
      const value = valueOf(day, hour);
      if (value > max) {
        max = value;
        peak = { day, hour };
        peakTies = 1;
      } else if (value && value === max) {
        peakTies += 1;
      }
    })
  );

  const dayHours = grid.map((hours) => hours.reduce((sum, cell) => sum + cell.hours, 0));

  const focus = hovered || selected;
  const focusCell = focus ? grid[focus.day][focus.hour] : null;

  const renderCell = (day, hour) => {
    const value = valueOf(day, hour);
    const isOn = selected && selected.day === day && selected.hour === hour;
    const { count, partners } = grid[day][hour];
    return (
      <td key={`${day}-${hour}`} className="wh-cell">
        <button
          type="button"
          className={`wh-cell__btn${isOn ? " is-on" : ""}${value ? "" : " is-zero"}`}
          style={cellStyle(value, max)}
          onClick={() => onSelect(day, hour)}
          onMouseEnter={() => setHovered({ day, hour })}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered({ day, hour })}
          onBlur={() => setHovered(null)}
          disabled={!count}
          aria-label={`${slotRange(day, hour)} 稼働 ${count}件、パートナー ${partners}`}
          aria-pressed={isOn}
        >
          {value || ""}
        </button>
      </td>
    );
  };

  const rows = transpose ? HOURS : HEAT_DAYS.map((_, day) => day);
  const cols = transpose ? HEAT_DAYS.map((_, day) => day) : HOURS;

  return (
    <div className="wh">
      <div className="wh__metric" role="group" aria-label="数えるもの">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`ga-chip${metric === m.key ? " is-on" : ""}`}
            onClick={() => onMetricChange(m.key)}
            aria-pressed={metric === m.key}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* 大きな数字3つ */}
      <div className="wh__stats">
        <span className="wh__stat">
          <strong>{total.toLocaleString()}</strong> 件の案件
        </span>
        <span className="wh__stat">
          <strong>{max.toLocaleString()}</strong> {unit}が最大同時稼働
        </span>
        {peak && (
          <span className="wh__stat">
            <strong>
              {HEAT_DAYS[peak.day]} {peak.hour}:00
            </strong>{" "}
            がピーク
            {peakTies > 1 && `（同数ほか${peakTies - 1}枠）`}
          </span>
        )}
      </div>

      <p className="wh__focus" aria-live="polite">
        {focusCell ? (
          <>
            <strong>{slotRange(focus.day, focus.hour)}</strong>　稼働{" "}
            {focusCell.count.toLocaleString()}件（パートナー{" "}
            {focusCell.partners.toLocaleString()}）
          </>
        ) : (
          <span className="wh__focus-hint">
            マスにマウスを乗せると内容が出ます。押すとその時間帯の案件一覧に切り替わります。
          </span>
        )}
      </p>

      <div className="wh__scroll">
        <table className={`wh__table${transpose ? " is-transposed" : ""}`}>
          <thead>
            <tr>
              <th className="wh__corner" aria-label={transpose ? "時/曜" : "曜/時"} />
              {cols.map((col) => (
                <th key={col} scope="col">
                  {transpose ? HEAT_DAYS[col] : `${col}時`}
                </th>
              ))}
              {!transpose && (
                <th scope="col" className="wh__total-head">
                  延べ時間
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row">{transpose ? `${row}時` : HEAT_DAYS[row]}</th>
                {cols.map((col) =>
                  transpose ? renderCell(col, row) : renderCell(row, col)
                )}
                {!transpose && <td className="wh__total">{formatHours(dayHours[row])}</td>}
              </tr>
            ))}
            {/* スマホ（縦横入れ替え）では延べ時間を最終行に回す */}
            {transpose && (
              <tr>
                <th scope="row" className="wh__total-head">
                  延べ
                </th>
                {cols.map((day) => (
                  <td key={day} className="wh__total">
                    {formatHours(dayHours[day])}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="wh__legend">
        <span>0</span>
        <span className="wh__legend-bar" aria-hidden="true" />
        <span>
          {max.toLocaleString()} {unit}
        </span>
        <span className="wh__legend-note">（表示中データの最大値を最も濃い色にしています）</span>
      </div>

      <p className="wh__note">
        マスの数字はその時間帯に稼働している{metricLabel}、延べ時間は曜日ごとの稼働時間の合計です。
        0時をまたぐ案件は翌日の曜日に数え、祝日は含みません。
        {excluded > 0 &&
          ` 曜日・稼働時刻が登録されていないか、祝日のみの案件 ${excluded.toLocaleString()}件は数えていません。`}
      </p>
    </div>
  );
};

export default WorkHeatmap;
