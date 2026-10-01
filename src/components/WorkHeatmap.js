// 曜日×時間帯ごとに、稼働している案件（またはパートナー）の数を濃淡で見せる。
// パートナー確保の検討向けなので、多いマスほど濃くして混んでいる時間帯を目立たせる。
//
// 数え方（どの案件をどのマスに入れるか）は呼び出し側が決める。ここは描くだけ。
//
// props:
//   grid        : [曜日7][時24] の { count, partners }
//   metric      : "count" | "partners"
//   onMetricChange
//   selected    : { day, hour } | null  クリックで選んでいるマス
//   onSelect    : (day, hour) => void   マスのクリック
//   excluded    : 時間帯を出せず数えていない案件数（曜日・時刻が無い、祝日のみ）
//   transpose   : true なら行＝時、列＝曜日（スマホ向け）

import React from "react";
import "./WorkHeatmap.css";

export const HEAT_DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const METRICS = [
  { key: "count", label: "案件数" },
  { key: "partners", label: "パートナー数" },
];

/** 濃さ 0〜1 → 背景色。0件は色を付けない（「少ない」と「無い」を見分けるため） */
const cellStyle = (ratio) => {
  if (ratio <= 0) return undefined;
  const alpha = 0.1 + ratio * 0.85;
  return {
    backgroundColor: `rgba(3, 102, 214, ${alpha.toFixed(3)})`,
    color: ratio > 0.5 ? "#fff" : "#0b2545",
  };
};

const PEAK_LIMIT = 3;

const WorkHeatmap = ({
  grid,
  metric,
  onMetricChange,
  selected,
  onSelect,
  excluded,
  transpose,
}) => {
  const metricLabel = METRICS.find((m) => m.key === metric)?.label || "";
  const valueOf = (day, hour) => grid[day][hour][metric];

  const cells = [];
  HEAT_DAYS.forEach((_, day) =>
    HOURS.forEach((hour) => cells.push({ day, hour, value: valueOf(day, hour) }))
  );
  const max = Math.max(0, ...cells.map((c) => c.value));
  const peaks = cells
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value || a.day - b.day || a.hour - b.hour)
    .slice(0, PEAK_LIMIT);

  const slotLabel = (day, hour) => `${HEAT_DAYS[day]} ${hour}時台`;

  const renderCell = (day, hour) => {
    const value = valueOf(day, hour);
    const isOn = selected && selected.day === day && selected.hour === hour;
    const { count, partners } = grid[day][hour];
    return (
      <td key={`${day}-${hour}`} className="wh-cell">
        <button
          type="button"
          className={`wh-cell__btn${isOn ? " is-on" : ""}`}
          style={cellStyle(max ? value / max : 0)}
          onClick={() => onSelect(day, hour)}
          disabled={!count}
          title={`${slotLabel(day, hour)}：案件 ${count}件／パートナー ${partners}`}
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
      <div className="wh__head">
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
        {peaks.length > 0 && (
          <p className="wh__peaks">
            多い時間帯：
            {peaks.map((p, i) => (
              <React.Fragment key={`${p.day}-${p.hour}`}>
                {i > 0 && " ／ "}
                <button
                  type="button"
                  className="wh__peak"
                  onClick={() => onSelect(p.day, p.hour)}
                >
                  {slotLabel(p.day, p.hour)} {p.value.toLocaleString()}
                </button>
              </React.Fragment>
            ))}
          </p>
        )}
      </div>

      <div className="wh__scroll">
        <table className={`wh__table${transpose ? " is-transposed" : ""}`}>
          <thead>
            <tr>
              <th className="wh__corner">{transpose ? "時/曜" : "曜/時"}</th>
              {cols.map((col) => (
                <th key={col} scope="col">
                  {transpose ? HEAT_DAYS[col] : col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row">{transpose ? `${row}時` : HEAT_DAYS[row]}</th>
                {cols.map((col) =>
                  transpose ? renderCell(col, row) : renderCell(row, col)
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="wh__note">
        マスの数字はその時間帯に稼働している{metricLabel}です（0時をまたぐ案件は翌日の曜日に数えます。祝日は含みません）。
        マスを押すと、その時間帯に稼働している案件の一覧に切り替わります。
        {excluded > 0 &&
          ` 曜日・稼働時刻が登録されていないか、祝日のみの案件 ${excluded.toLocaleString()}件は数えていません。`}
      </p>
    </div>
  );
};

export default WorkHeatmap;
