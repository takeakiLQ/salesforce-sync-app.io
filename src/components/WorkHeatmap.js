// 曜日×時間帯ごとに、稼働している案件（またはパートナー）の数を濃淡で見せる。
// パートナー確保の検討向けなので、多いマスほど濃くして混んでいる時間帯を目立たせる。
//
// 数え方（どの案件をどのマスに入れるか、どの時間帯区分か）は呼び出し側が決める。
// ここは描くことと、操作（区分の選択・表示方法・指標）を受け取ることだけを持つ。
//
// props:
//   blocks        : [{ key, title, desc, palette, grid, total, cats }]
//                   grid は [曜日7][時24] の { count, partners, hours }。
//                   まとめて表示なら1つ、区分ごとに表示なら区分の数だけ
//   metric        : "count" | "partners"
//   onMetricChange
//   categoryCounts: { am, span, pm } 区分ごとの案件数
//   selectedCats  : 含める区分のキー配列
//   onToggleCat   : (key) => void
//   split         : 区分ごとに表示するか
//   onSplitChange : (bool) => void
//   selected      : { day, hour, cats } | null  クリックで選んでいるマス
//   onSelect      : (day, hour, cats) => void   マスのクリック
//   excluded      : 時間帯を出せず数えていない案件数（曜日・時刻が無い、祝日のみ）
//   transpose     : true なら行＝時、列＝曜日（スマホ向け）

import React, { useState } from "react";
import "./WorkHeatmap.css";

export const HEAT_DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/* ===== 色 =====
   薄い → 濃いの3色。0件は灰色にして「少ない」と「無い」を見分ける。
   区分ごとに表示したとき、どの表がどの区分か色でも分かるよう色相を変える。 */
export const PALETTES = {
  teal: [
    [211, 235, 234],
    [27, 138, 140],
    [11, 49, 66],
  ],
  amber: [
    [253, 236, 200],
    [222, 134, 30],
    [110, 50, 10],
  ],
  violet: [
    [226, 220, 245],
    [111, 84, 196],
    [45, 27, 94],
  ],
};

/**
 * 時間帯区分。正午を境に分ける。
 * 夜に始まり0時をまたぐ案件は「午後のみ」に入れる（始まりが午後なので）。
 */
export const HEAT_CATEGORIES = [
  { key: "am", label: "午前のみ", desc: "12:00までに終わる", palette: "amber" },
  { key: "span", label: "午前午後またぎ", desc: "12:00をまたぐ", palette: "teal" },
  { key: "pm", label: "午後のみ", desc: "12:00以降に始まる", palette: "violet" },
];

const METRICS = [
  { key: "count", label: "案件数", unit: "件" },
  { key: "partners", label: "パートナー数", unit: "パートナー" },
];

const rgb = (color) => `rgb(${color.join(",")})`;

/** 0〜1 → 3色の間を補間した色 */
const mix = (stops, ratio) => {
  const [low, mid, high] = stops;
  const [from, to, t] = ratio <= 0.5 ? [low, mid, ratio / 0.5] : [mid, high, (ratio - 0.5) / 0.5];
  return from.map((value, i) => Math.round(value + (to[i] - value) * t));
};

const cellStyle = (stops, value, max) => {
  if (!value || !max) return undefined;
  const ratio = value / max;
  return {
    backgroundColor: rgb(mix(stops, ratio)),
    color: ratio > 0.45 ? "#fff" : rgb(stops[2]),
  };
};

const formatHours = (hours) => `${Number(hours.toFixed(1)).toLocaleString()}h`;

const slotRange = (day, hour) => `${HEAT_DAYS[day]}曜 ${hour}:00〜${hour + 1}:00`;

/* ===== 1枚分 ===== */

const HeatmapBlock = ({
  title,
  desc,
  palette,
  grid,
  total,
  cats,
  metric,
  selected,
  onSelect,
  transpose,
}) => {
  // マウスを乗せているマス。内容を上の1行に出す（マスには数字しか書かないため）
  const [hovered, setHovered] = useState(null);

  const stops = PALETTES[palette] || PALETTES.teal;
  const { unit } = METRICS.find((m) => m.key === metric) || METRICS[0];
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
          style={cellStyle(stops, value, max)}
          onClick={() => onSelect(day, hour, cats)}
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
    <section className="wh-block">
      {title && (
        <h3 className="wh-block__title">
          <span className="wh-block__swatch" style={{ background: rgb(stops[1]) }} />
          {title}
          {desc && <span className="wh-block__desc">{desc}</span>}
        </h3>
      )}

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
        <span
          className="wh__legend-bar"
          aria-hidden="true"
          style={{ background: `linear-gradient(to right, ${stops.map(rgb).join(", ")})` }}
        />
        <span>
          {max.toLocaleString()} {unit}
        </span>
        <span className="wh__legend-note">
          （{title ? "この区分" : "表示中データ"}の最大値を最も濃い色にしています）
        </span>
      </div>
    </section>
  );
};

/* ===== 全体（指標・区分・表示方法の操作と、1枚または区分ごとの表） ===== */

const WorkHeatmap = ({
  blocks,
  metric,
  onMetricChange,
  categoryCounts,
  selectedCats,
  onToggleCat,
  split,
  onSplitChange,
  selected,
  onSelect,
  excluded,
  transpose,
}) => {
  const { label: metricLabel } = METRICS.find((m) => m.key === metric) || METRICS[0];

  // 選んでいるマスは、同じ区分の組み合わせの表にだけ枠を付ける
  const sameCats = (a, b) => a.length === b.length && a.every((key) => b.includes(key));

  return (
    <div className="wh">
      <div className="wh__controls">
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
        <div className="wh__seg" role="group" aria-label="表示方法">
          <button
            type="button"
            className={!split ? "is-on" : ""}
            onClick={() => onSplitChange(false)}
            aria-pressed={!split}
          >
            まとめて表示
          </button>
          <button
            type="button"
            className={split ? "is-on" : ""}
            onClick={() => onSplitChange(true)}
            aria-pressed={split}
          >
            区分ごとに表示
          </button>
        </div>
      </div>

      {/* 時間帯区分。押して含める／外す。最後の1つは外せない（何も出なくなるため） */}
      <div className="wh__cats" role="group" aria-label="時間帯区分">
        {HEAT_CATEGORIES.map((cat) => {
          const isOn = selectedCats.includes(cat.key);
          const stops = PALETTES[cat.palette];
          return (
            <button
              key={cat.key}
              type="button"
              className={`wh-cat${isOn ? " is-on" : ""}`}
              style={isOn ? { borderColor: rgb(stops[1]) } : undefined}
              onClick={() => onToggleCat(cat.key)}
              disabled={isOn && selectedCats.length === 1}
              aria-pressed={isOn}
            >
              <span className="wh-cat__name">
                <span className="wh-block__swatch" style={{ background: rgb(stops[1]) }} />
                {cat.label}
              </span>
              <span className="wh-cat__count">
                {(categoryCounts[cat.key] || 0).toLocaleString()}件
              </span>
              <span className="wh-cat__desc">{cat.desc}</span>
            </button>
          );
        })}
      </div>

      {blocks.map((block) => (
        <HeatmapBlock
          key={block.key}
          {...block}
          metric={metric}
          selected={selected && sameCats(selected.cats, block.cats) ? selected : null}
          onSelect={onSelect}
          transpose={transpose}
        />
      ))}

      <p className="wh__note">
        マスの数字はその時間帯に稼働している{metricLabel}、延べ時間は曜日ごとの稼働時間の合計です。
        0時をまたぐ案件は翌日の曜日に数え、祝日は含みません。
        時間帯区分は正午で分け、夜に始まり0時をまたぐ案件は「午後のみ」に含めます。
        {excluded > 0 &&
          ` 曜日・稼働時刻が登録されていないか、祝日のみの案件 ${excluded.toLocaleString()}件は数えていません。`}
      </p>
    </div>
  );
};

export default WorkHeatmap;
