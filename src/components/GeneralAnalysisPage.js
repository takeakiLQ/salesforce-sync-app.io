// 案件分析ページ。
// 「稼働中案件」シートを主管・支店・案件名・パートナー名で絞り込み、件数と一覧を出す。
//
// 配車状況（DriverSituation__c）は絞り込みにも列にも出していない。
// このシートがそもそも稼働中のものだけを持つため、区別する意味がない。
//
// 開いた時点では一覧を出さない。主管＋支店を選ぶか、案件名／パートナー名の
// どちらかを入れてもらってから初めて表示する（KEYWORD_MIN_LENGTH 付近を参照）。
// 全件が黙って画面に出るのを避けるため。
//
// 管理担当者による絞り込みは、この時点では入れていない。
// 稼働中案件シートに担当者の列が無く、パートナー情報シートの
// AdministratorName__r.Name を Partner__r.ID_18__c ⇔ SF_ID__c で
// 結合する必要があるため（＝「案件の担当者」ではなく
// 「パートナーの管理担当者」になる）、意味を確認してから追加する。

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HeaderMenu from "./HeaderMenu";
import SessionExpiredNotice from "./SessionExpiredNotice";
import ConfirmLink from "./ConfirmLink";
import Pagination from "./Pagination";
import ScrollTopButton from "./ScrollTopButton";
import PullToRefresh from "./PullToRefresh";
import { fetchSheetRows, isAuthError } from "../utils/sheetsApi";
import { syncSheetCaches } from "../utils/updatedAtApi";
import useMediaQuery from "../utils/useMediaQuery";
import useDebouncedSave from "../utils/useDebouncedSave";
import { groupLabel, groupRank } from "../utils/groupOptions";
import "./AnalysisPage.css";
import "./GeneralAnalysisPage.css";

// この画面で使うのは A〜AE 列（Id 〜 RecordType.Name）だけで、
// AF 以降の空列21本・曜日×時間の稼働フラグ168本・初回配車の履歴は使わない。
// それでも A1:ZZ のままにしているのは、空車情報検索・協力会社分析と
// 範囲の文字列を揃えるため。sheetsApi のキャッシュは範囲ごとに持つので、
// ここだけ狭めると通信もパース済みの配列も二重に抱えることになる。
// （協力会社分析が使う 初回開始日 は 222列目にあり、狭い範囲では取れない）
const RANGE_ASSIGN = "稼働中案件!A1:ZZ";
const FILTER_CACHE_KEY = "generalAnalysisFilters";
const PAGE_SIZE = 20;

// 開いただけで全案件が並ぶのを避けるため、一覧には条件を必須にしている。
//   主管と支店の両方を選ぶ／案件名かパートナー名を KEYWORD_MIN_LENGTH 文字以上入れる
// のどちらかを満たすまで、一覧も金額の集計も出さない。
//
// 文字数はあくまで「一覧を出してよいか」の判定にだけ使う。
// 1文字しか入っていない欄も絞り込みには効かせる（打った条件は必ず反映する）。
const KEYWORD_MIN_LENGTH = 2;

/** 列が空の行をまとめる見出し。絞り込みから漏れて件数が合わなくなるのを防ぐ */
const UNSET = "(未設定)";

/** Salesforce の「無期限」を表す番人値。稼働終了日がこれなら継続中 */
const OPEN_ENDED_DATE = "3999-12-31";

const DAY_MAP = {
  月曜日: "月",
  火曜日: "火",
  水曜日: "水",
  木曜日: "木",
  金曜日: "金",
  土曜日: "土",
  日曜日: "日",
  祝日: "祝",
};

/* ===== 値の取り出しと整形 ===== */

const cellValue = (row, column) => {
  const value = (row[column] ?? "").toString().trim();
  return value || UNSET;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeText = (value) =>
  (value ?? "").toString().normalize("NFKC").toLowerCase().trim();

const formatMoney = (value) => {
  const n = toNumber(value);
  return n ? n.toLocaleString() : "";
};

const formatRate = (value) =>
  Number.isFinite(value) ? `${value.toFixed(1)}%` : "";

const formatTime = (value) => (value ? value.slice(0, 5) : "");

/** 稼働終了日。番人値（3999-12-31）は日付ではなく「継続中」と読ませる */
const formatEndDate = (value) => {
  if (!value) return "";
  return value.startsWith(OPEN_ENDED_DATE) ? "継続中" : value;
};

const formatWorkingDays = (value) =>
  (value || "")
    .split(";")
    .map((day) => DAY_MAP[day.trim()] || day.trim())
    .filter(Boolean)
    .join("");

const formatArea = (row) =>
  `${row["PrefecturesFree__c"] || ""}${row["CityFree__c"] || ""}`;

/* ===== 単価の計算 =====
   シートが持っているのは月額（売上・原価・粗利）とコマ数と稼働時刻だけなので、
   1日あたり・1時間あたりはここで割り戻す。
   0 除算や時刻欠損は NaN で返し、表示側で「-」にする。 */

/** "13:00:00.000Z" → 13.0（時間） */
const parseHours = (value) => {
  if (!value) return NaN;
  const [hour, minute] = String(value).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
  return hour + minute / 60;
};

/** 拘束時間（時間）。終了が開始より前なら日跨ぎとみなす */
const workHours = (row) => {
  const start = parseHours(row["OperationStartTime__c"]);
  const end = parseHours(row["OperationEndTime__c"]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return NaN;
  const span = end >= start ? end - start : end + 24 - start;
  return span > 0 ? span : NaN;
};

/** 1コマ（＝1日）あたりの単価。月額 ÷ コマ数 */
const perDay = (row, column) => {
  const slots = toNumber(row["KADO_YOTEI_NISSUU_AUTO__c"]);
  if (!slots) return NaN;
  return toNumber(row[column]) / slots;
};

/** 時間当たり売上 = 売上/月 ÷ コマ数 ÷ 拘束時間 */
const salesPerHour = (row) => {
  const daily = perDay(row, "Scheduled_sales_calculation__c");
  const hours = workHours(row);
  if (!Number.isFinite(daily) || !Number.isFinite(hours)) return NaN;
  return daily / hours;
};

/** 粗利率（%）= 粗利/月 ÷ 売上/月 */
const grossMarginPct = (row) => {
  const sales = toNumber(row["Scheduled_sales_calculation__c"]);
  if (!sales) return NaN;
  return (toNumber(row["Yotei_Arari_Keisan__c"]) / sales) * 100;
};

/** 計算値の表示。桁を丸めて3桁区切り。計算できなければ「-」 */
const formatComputed = (value, suffix = "") =>
  Number.isFinite(value) ? `${Math.round(value).toLocaleString()}${suffix}` : "-";

const formatHours = (value) =>
  Number.isFinite(value) ? `${Number(value.toFixed(2))}h` : "-";

/** "13:00〜16:00"。片方でも欠けていれば空 */
const formatTimeRange = (row) => {
  const start = formatTime(row["OperationStartTime__c"]);
  const end = formatTime(row["OperationEndTime__c"]);
  return start && end ? `${start}〜${end}` : "";
};

/** Salesforce レコードビュー（one.app 形式） */
const sfLink = (id) =>
  id ? `https://logiquest.lightning.force.com/one/one.app#/sObject/${id}/view` : null;

// パートナー区分ごとの色。区分タグとカード左端の帯で同じ色を使い、
// 一覧をスクロールしたとき色だけで区分を追えるようにする。
const CONTRACT_TYPE_CLASS = {
  持込: "ga-type--mochikomi",
  業者: "ga-type--gyosha",
};

const contractTypeClass = (row) =>
  CONTRACT_TYPE_CLASS[row["Partner_Keiyaku_type_temp__c"]] || "ga-type--other";

/* ===== 内訳（集計）の定義 ===== */

/** 何で切るか */
const BREAKDOWN_DIMENSIONS = [
  { key: "Partner_Keiyaku_type_temp__c", label: "PT区分" },
  { key: "Group_FY22__c", label: "主管", format: groupLabel },
  { key: "Branch__c", label: "支店" },
  { key: "PrefecturesFree__c", label: "都道府県" },
  { key: "CityFree__c", label: "市区町村" },
];

/** 何で並べるか（棒の長さと構成比もこれに従う） */
const BREAKDOWN_METRICS = [
  { key: "count", label: "件数" },
  { key: "sales", label: "売上/月" },
  { key: "profit", label: "粗利/月" },
];

/** 市区町村など、値の種類が多い切り口で既定に出す行数 */
const BREAKDOWN_LIMIT = 20;

/* ===== 一覧の列定義 ===== */

const HEADERS = [
  { label: "主管", key: "Group_FY22__c", type: "group", w: "col-s" },
  { label: "支店", key: "Branch__c", type: "text", w: "col-s" },
  { label: "案件名", key: "Name", type: "text", w: "col-l", wrap: true },
  { label: "パートナー", key: "Partner__r.Name", type: "text", w: "col-m", wrap: true },
  { label: "契約区分", key: "Partner_Keiyaku_type_temp__c", type: "text", w: "col-s" },
  { label: "稼働地", key: "PrefecturesFree__c", type: "text", w: "col-m" },
  { label: "稼働開始", key: "OperationStartDate__c", type: "date", w: "col-s" },
  { label: "稼働終了", key: "OperationEndDate__c", type: "date", w: "col-s" },
  { label: "曜日", key: "WorkingDay__c", type: "text", w: "col-s" },
  { label: "コマ", key: "KADO_YOTEI_NISSUU_AUTO__c", type: "number", w: "col-xs", right: true },
  // 拘束時間の下に、その根拠になる開始〜終了時刻を添える
  { label: "拘束", key: "__hours__", type: "computed", compute: workHours, w: "col-s", right: true },
  // 月額の下に、割り戻した1日あたり単価を括弧で添える
  {
    label: "売上/月",
    key: "Scheduled_sales_calculation__c",
    type: "number",
    w: "col-s",
    right: true,
    perDay: true,
  },
  {
    label: "原価/月",
    key: "Yotei_Genka_keisan__c",
    type: "number",
    w: "col-s",
    right: true,
    perDay: true,
  },
  {
    label: "粗利/月",
    key: "Yotei_Arari_Keisan__c",
    type: "number",
    w: "col-s",
    right: true,
    perDay: true,
  },
  { label: "粗利率", key: "__margin__", type: "computed", compute: grossMarginPct, w: "col-xs", right: true },
  {
    label: "売上/時",
    key: "__salesPerHour__",
    type: "computed",
    compute: salesPerHour,
    w: "col-s",
    right: true,
  },
  // カードでは出しているので、PCの表にも置いて項目を揃える
  { label: "配車申請コメント", key: "Haisyasinsei_komento__c", type: "text", w: "col-xl", wrap: true },
];

/** 並び替え用の比較キー。列の型ごとに数値／日時／文字列へ寄せる */
const sortValue = (row, header) => {
  const raw = row[header.key] ?? "";
  switch (header.type) {
    case "computed": {
      // 計算できなかった行は末尾へ寄せる
      const value = header.compute(row);
      return Number.isFinite(value) ? value : -Infinity;
    }
    case "group":
      return groupRank(raw);
    case "number":
      return toNumber(raw);
    case "date": {
      const time = new Date(raw).getTime();
      return Number.isNaN(time) ? -Infinity : time;
    }
    default:
      return String(raw);
  }
};

/* ===== 絞り込み条件の復元 ===== */

const loadCachedFilters = () => {
  try {
    const raw = localStorage.getItem(FILTER_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("絞り込み条件の復元に失敗しました", error);
    return {};
  }
};

const toArray = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);

/* ===== 絞り込みチップ ===== */

const FacetGroup = ({
  title,
  options,
  selected,
  onToggle,
  onClear,
  renderLabel,
  lockedMessage,
}) => (
  <div className="ga-facet">
    <div className="ga-facet__head">
      <span className="ga-facet__title">
        {title}
        {selected.length > 0 && (
          <span className="ga-facet__badge">{selected.length}</span>
        )}
      </span>
      <button
        type="button"
        className="clear-btn"
        onClick={onClear}
        disabled={!selected.length}
      >
        クリア
      </button>
    </div>

    {lockedMessage ? (
      <p className="ga-facet__empty">{lockedMessage}</p>
    ) : options.length === 0 ? (
      <p className="ga-facet__empty">該当する値がありません。</p>
    ) : (
      <div className="ga-facet__chips">
        {options.map(({ value, count }) => {
          const isOn = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              className={`ga-chip${isOn ? " is-on" : ""}${count === 0 ? " is-empty" : ""}`}
              onClick={() => onToggle(value)}
              aria-pressed={isOn}
            >
              <span className="ga-chip__label">
                {renderLabel ? renderLabel(value) : value}
              </span>
              <span className="ga-chip__count">{count}</span>
            </button>
          );
        })}
      </div>
    )}
  </div>
);

const GeneralAnalysisPage = () => {
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authExpired, setAuthExpired] = useState(false);

  // 列数が多いため、狭い画面では表ではなくカードで描く
  const isNarrow = useMediaQuery("(max-width: 768px)");
  const listTopRef = useRef(null);

  const cached = useMemo(loadCachedFilters, []);
  const [selectedGroups, setSelectedGroups] = useState(() => toArray(cached.selectedGroups));
  const [selectedBranches, setSelectedBranches] = useState(() => toArray(cached.selectedBranches));
  const [projectKeyword, setProjectKeyword] = useState(() =>
    typeof cached.projectKeyword === "string" ? cached.projectKeyword : ""
  );
  const [partnerKeyword, setPartnerKeyword] = useState(() =>
    typeof cached.partnerKeyword === "string" ? cached.partnerKeyword : ""
  );
  // 並び順は保存しない。開くたびに「指定なし」（＝シートの並び）から始める。
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);

  // 内訳の切り口と指標。件数が多い切り口は既定で上位のみ出す
  // 保存済みの値でも、選択肢から消えていれば既定に戻す
  const [breakdownKey, setBreakdownKey] = useState(() =>
    BREAKDOWN_DIMENSIONS.some((d) => d.key === cached.breakdownKey)
      ? cached.breakdownKey
      : BREAKDOWN_DIMENSIONS[0].key
  );
  const [breakdownMetric, setBreakdownMetric] = useState(() =>
    BREAKDOWN_METRICS.some((m) => m.key === cached.breakdownMetric)
      ? cached.breakdownMetric
      : BREAKDOWN_METRICS[0].key
  );
  const [showAllBreakdown, setShowAllBreakdown] = useState(false);

  // 内訳の行をクリックしたときの掘り下げ。{ dimension, value }
  // 内訳の集計自体はこれを無視し、下の明細と件数だけを絞る。
  const [drill, setDrill] = useState(null);

  useDebouncedSave(FILTER_CACHE_KEY, {
    selectedGroups,
    selectedBranches,
    projectKeyword,
    partnerKeyword,
    breakdownKey,
    breakdownMetric,
  });

  /* ===== データ取得（sheetsApi 側でキャッシュされるため再訪時は即時） =====
     silent: 全画面スピナーを出さずに取り直す。
     引いて更新はそれ自身がインジケータを出すため、二重に回さない。 */
  const loadData = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    setAuthExpired(false);
    try {
      setAllRows(await fetchSheetRows(RANGE_ASSIGN, { force }));
    } catch (e) {
      console.error(e);
      if (isAuthError(e)) setAuthExpired(true);
      else setError("データ取得中にエラーが発生しました。");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ===== 絞り込み ===== */
  const normalizedProject = useMemo(
    () => normalizeText(projectKeyword),
    [projectKeyword]
  );
  const normalizedPartner = useMemo(
    () => normalizeText(partnerKeyword),
    [partnerKeyword]
  );

  // facet ごとの判定を分けて持つ。
  // 選択肢の件数を出すとき「その facet だけ外した集合」が要るため。
  // 案件名とパートナー名は別の欄なので、両方入っていれば AND になる。
  const predicates = useMemo(
    () => ({
      group: (row) =>
        !selectedGroups.length || selectedGroups.includes(cellValue(row, "Group_FY22__c")),
      branch: (row) =>
        !selectedBranches.length || selectedBranches.includes(cellValue(row, "Branch__c")),
      project: (row) =>
        !normalizedProject || normalizeText(row["Name"]).includes(normalizedProject),
      partner: (row) =>
        !normalizedPartner ||
        normalizeText(row["Partner__r.Name"]).includes(normalizedPartner),
    }),
    [selectedGroups, selectedBranches, normalizedProject, normalizedPartner]
  );

  /** except に渡した facet の条件だけ外して絞り込む */
  const rowsExcept = useCallback(
    (except) =>
      allRows.filter((row) =>
        Object.entries(predicates).every(([name, test]) => name === except || test(row))
      ),
    [allRows, predicates]
  );

  // 案件名・パートナー名は、どちらか一方が規定文字数に達していればよい
  const longestKeyword = Math.max(normalizedProject.length, normalizedPartner.length);

  /** 一覧を出してよい状態か（主管＋支店、またはキーワード） */
  const isSearchReady =
    longestKeyword >= KEYWORD_MIN_LENGTH ||
    (selectedGroups.length > 0 && selectedBranches.length > 0);

  /** 条件が足りないとき、何が足りないかを1行で返す */
  const missingCondition = () => {
    if (longestKeyword > 0) {
      return `案件名かパートナー名が、あと${
        KEYWORD_MIN_LENGTH - longestKeyword
      }文字必要です。`;
    }
    if (!selectedGroups.length) return "主管が選ばれていません。";
    return "支店が選ばれていません。";
  };

  // 条件を満たすまで絞り込み自体を走らせない（全件を並べ替える無駄を避ける）
  const filteredRows = useMemo(
    () => (isSearchReady ? rowsExcept(null) : []),
    [isSearchReady, rowsExcept]
  );

  /**
   * 選択肢と件数。
   * 選択済みの値は件数0でも必ず残す（消えると解除できなくなるため）。
   */
  const buildOptions = useCallback((rows, column, selected, compare) => {
    const counts = new Map();
    rows.forEach((row) => {
      const value = cellValue(row, column);
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    selected.forEach((value) => {
      if (!counts.has(value)) counts.set(value, 0);
    });
    return Array.from(counts, ([value, count]) => ({ value, count })).sort(compare);
  }, []);

  const byName = (a, b) => a.value.localeCompare(b.value, "ja");

  const groupOptions = useMemo(
    () =>
      buildOptions(
        rowsExcept("group"),
        "Group_FY22__c",
        selectedGroups,
        (a, b) => groupRank(a.value) - groupRank(b.value) || byName(a, b)
      ),
    [buildOptions, rowsExcept, selectedGroups]
  );

  const branchOptions = useMemo(
    () => buildOptions(rowsExcept("branch"), "Branch__c", selectedBranches, byName),
    [buildOptions, rowsExcept, selectedBranches]
  );

  // 主管を変えたとき、その主管に存在しない支店の選択は落とす。
  // （残すと件数0のまま「該当なし」になり、原因が分かりにくい）
  useEffect(() => {
    if (!selectedGroups.length || !allRows.length) return;
    const available = new Set(
      allRows
        .filter((row) => selectedGroups.includes(cellValue(row, "Group_FY22__c")))
        .map((row) => cellValue(row, "Branch__c"))
    );
    setSelectedBranches((prev) => {
      const next = prev.filter((branch) => available.has(branch));
      return next.length === prev.length ? prev : next;
    });
  }, [selectedGroups, allRows]);

  const toggleValue = (setter) => (value) =>
    setter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );

  const hasAnyFilter =
    selectedGroups.length > 0 ||
    selectedBranches.length > 0 ||
    projectKeyword.length > 0 ||
    partnerKeyword.length > 0;

  const clearAllFilters = () => {
    setSelectedGroups([]);
    setSelectedBranches([]);
    setProjectKeyword("");
    setPartnerKeyword("");
  };

  // 切り口や絞り込みが変わったら、内訳からの掘り下げは解除する。
  // 残すと「内訳には出ているのに明細が空」という状態になりうるため。
  useEffect(() => {
    setDrill(null);
  }, [
    breakdownKey,
    selectedGroups,
    selectedBranches,
    normalizedProject,
    normalizedPartner,
  ]);

  // 更新でデータが入れ替わり、掘り下げ中の値が消えていたら解除する。
  // 残すと明細が0件になり、解除ボタンごと画面から消えて戻れなくなる。
  useEffect(() => {
    if (!drill) return;
    const stillExists = filteredRows.some(
      (row) => cellValue(row, drill.dimension) === drill.value
    );
    if (!stillExists) setDrill(null);
  }, [filteredRows, drill]);

  /**
   * 明細と件数に使う行。内訳から掘り下げていればさらに絞る。
   * 内訳の集計そのものは filteredRows のままにして、
   * 掘り下げても他の行が消えないようにしている。
   */
  const listRows = useMemo(() => {
    if (!drill) return filteredRows;
    return filteredRows.filter(
      (row) => cellValue(row, drill.dimension) === drill.value
    );
  }, [filteredRows, drill]);

  /* ===== 集計 ===== */
  const summary = useMemo(() => {
    const total = listRows.reduce(
      (acc, row) => {
        acc.slots += toNumber(row["KADO_YOTEI_NISSUU_AUTO__c"]);
        acc.sales += toNumber(row["Scheduled_sales_calculation__c"]);
        acc.cost += toNumber(row["Yotei_Genka_keisan__c"]);
        acc.profit += toNumber(row["Yotei_Arari_Keisan__c"]);
        return acc;
      },
      { slots: 0, sales: 0, cost: 0, profit: 0 }
    );
    return {
      ...total,
      partners: new Set(
        listRows.map((row) => row["Partner__r.ID_18__c"]).filter(Boolean)
      ).size,
      margin: total.sales ? (total.profit / total.sales) * 100 : NaN,
    };
  }, [listRows]);

  /* ===== 内訳（集計） =====
     絞り込んだ結果に対して集計する。主管＋支店で絞ってから市区町村で切る、
     といった掘り下げ方を想定している。 */
  const breakdown = useMemo(() => {
    const dimension = BREAKDOWN_DIMENSIONS.find((d) => d.key === breakdownKey);
    if (!dimension) return [];

    const map = new Map();
    filteredRows.forEach((row) => {
      const value = cellValue(row, dimension.key);
      const entry = map.get(value) || {
        value,
        count: 0,
        slots: 0,
        sales: 0,
        profit: 0,
      };
      entry.count += 1;
      entry.slots += toNumber(row["KADO_YOTEI_NISSUU_AUTO__c"]);
      entry.sales += toNumber(row["Scheduled_sales_calculation__c"]);
      entry.profit += toNumber(row["Yotei_Arari_Keisan__c"]);
      map.set(value, entry);
    });

    const total = filteredRows.reduce(
      (sum, row) => {
        sum.count += 1;
        sum.sales += toNumber(row["Scheduled_sales_calculation__c"]);
        sum.profit += toNumber(row["Yotei_Arari_Keisan__c"]);
        return sum;
      },
      { count: 0, sales: 0, profit: 0 }
    );

    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        margin: entry.sales ? (entry.profit / entry.sales) * 100 : NaN,
        share: total[breakdownMetric] ? entry[breakdownMetric] / total[breakdownMetric] : 0,
      }))
      .sort((a, b) => b[breakdownMetric] - a[breakdownMetric]);
  }, [filteredRows, breakdownKey, breakdownMetric]);

  const breakdownMax = breakdown.length ? breakdown[0][breakdownMetric] : 0;
  const breakdownRows = showAllBreakdown ? breakdown : breakdown.slice(0, BREAKDOWN_LIMIT);
  const hiddenBreakdownCount = breakdown.length - breakdownRows.length;

  const breakdownDimension = BREAKDOWN_DIMENSIONS.find((d) => d.key === breakdownKey);

  /** 同じ行をもう一度押したら解除する */
  const toggleDrill = (value) =>
    setDrill((prev) =>
      prev && prev.dimension === breakdownKey && prev.value === value
        ? null
        : { dimension: breakdownKey, value }
    );

  /* ===== 並び替え ===== */
  const sortedRows = useMemo(() => {
    const header = HEADERS.find((h) => h.key === sortConfig.key);
    if (!header) return listRows;

    const direction = sortConfig.direction === "desc" ? -1 : 1;
    return [...listRows].sort((a, b) => {
      const av = sortValue(a, header);
      const bv = sortValue(b, header);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv), "ja") * direction;
      }
      return (av - bv) * direction;
    });
  }, [listRows, sortConfig]);

  const handleSort = (key) =>
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));

  /* ===== ページング ===== */
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE)),
    [sortedRows.length]
  );

  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, currentPage]);

  // 条件が変われば先頭ページへ戻す
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedGroups, selectedBranches, normalizedProject, normalizedPartner, drill]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const startIndex = sortedRows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const endIndex = Math.min(currentPage * PAGE_SIZE, sortedRows.length);

  /* ===== セルの描画 ===== */
  const renderCell = (header, row) => {
    switch (header.key) {
      case "Group_FY22__c":
        return groupLabel(row["Group_FY22__c"]);
      case "Name":
        return row["Id"] ? (
          <ConfirmLink
            href={sfLink(row["Id"])}
            description={`案件：${row["Name"] || "案件名不明"}`}
            className="name-link"
          >
            {row["Name"] || "案件名不明"}
          </ConfirmLink>
        ) : (
          row["Name"] || ""
        );
      case "Partner__r.Name":
        return row["Partner__r.ID_18__c"] ? (
          <ConfirmLink
            href={sfLink(row["Partner__r.ID_18__c"])}
            description={`パートナー：${row["Partner__r.Name"] || "不明"}`}
            className="name-link"
          >
            {row["Partner__r.Name"] || "不明"}
          </ConfirmLink>
        ) : (
          row["Partner__r.Name"] || ""
        );
      case "PrefecturesFree__c":
        return formatArea(row);
      case "OperationEndDate__c":
        return formatEndDate(row["OperationEndDate__c"]);
      case "WorkingDay__c":
        return formatWorkingDays(row["WorkingDay__c"]);
      case "KADO_YOTEI_NISSUU_AUTO__c":
        return row["KADO_YOTEI_NISSUU_AUTO__c"] || "";
      case "__hours__":
        return (
          <>
            {formatHours(workHours(row))}
            {formatTimeRange(row) && (
              <span className="ga-sub">{formatTimeRange(row)}</span>
            )}
          </>
        );
      case "__margin__":
        return formatRate(grossMarginPct(row)) || "-";
      case "__salesPerHour__":
        return formatComputed(salesPerHour(row));
      default:
        if (header.type !== "number") return row[header.key] || "";
        // 月額と、その下に1日あたり単価
        return (
          <>
            {formatMoney(row[header.key]) || "-"}
            {header.perDay && (
              <span className="ga-sub">
                （{formatComputed(perDay(row, header.key), "/日")}）
              </span>
            )}
          </>
        );
    }
  };

  /* ===== 表示 ===== */
  return (
    <div className="anken-page">
      <HeaderMenu title="案件分析ページ" />

      <div className="main-content">
        {loading ? (
          <div className="spinner-wrapper">
            <div className="spinner" aria-label="読み込み中" />
            <div className="loading-text">データ取得中です...</div>
          </div>
        ) : authExpired ? (
          <SessionExpiredNotice onRetry={() => loadData({ force: true })} />
        ) : error ? (
          <p style={{ color: "#b00020" }}>{error}</p>
        ) : (
          <>
            {/* 絞り込み */}
            <div className="ga-filters">
              <div className="ga-filters__head">
                <h2 className="ga-filters__title">絞り込み</h2>
                <button
                  type="button"
                  className="clear-btn"
                  onClick={clearAllFilters}
                  disabled={!hasAnyFilter}
                >
                  すべて解除
                </button>
              </div>

              <FacetGroup
                title="主管"
                options={groupOptions}
                selected={selectedGroups}
                onToggle={toggleValue(setSelectedGroups)}
                onClear={() => setSelectedGroups([])}
                renderLabel={groupLabel}
              />
              <FacetGroup
                title="支店"
                options={branchOptions}
                selected={selectedBranches}
                onToggle={toggleValue(setSelectedBranches)}
                onClear={() => setSelectedBranches([])}
                // 主管を選ぶ前は全支店が並んで選びにくいため、順序を固定する
                lockedMessage={
                  selectedGroups.length ? "" : "先に主管を選んでください。"
                }
              />
              <div className="detail-search">
                <label className="detail-search__label">
                  案件名で絞り込み
                  <input
                    type="text"
                    value={projectKeyword}
                    onChange={(e) => setProjectKeyword(e.target.value)}
                    placeholder="例: 光合金"
                  />
                </label>
                <button
                  type="button"
                  className="detail-search__clear"
                  onClick={() => setProjectKeyword("")}
                  disabled={!projectKeyword}
                >
                  クリア
                </button>

                <label className="detail-search__label">
                  パートナー名で絞り込み
                  <input
                    type="text"
                    value={partnerKeyword}
                    onChange={(e) => setPartnerKeyword(e.target.value)}
                    placeholder="例: 小柳"
                  />
                </label>
                <button
                  type="button"
                  className="detail-search__clear"
                  onClick={() => setPartnerKeyword("")}
                  disabled={!partnerKeyword}
                >
                  クリア
                </button>
              </div>

              <p className="ga-filters__note">
                案件名かパートナー名が{KEYWORD_MIN_LENGTH}
                文字以上になると、主管・支店を選ばなくても一覧が出ます。
                両方入れた場合は、その両方に当てはまる案件だけを表示します。
              </p>
            </div>

            {/* 一覧 */}
            <div ref={listTopRef} />

            {!isSearchReady ? (
              <div className="ga-gate">
                <p className="ga-gate__title">
                  案件を表示するには、次のどちらかを指定してください
                </p>
                <ul className="ga-gate__list">
                  <li>
                    <strong>主管</strong>と<strong>支店</strong>を両方選ぶ
                  </li>
                  <li>
                    または<strong>案件名</strong>か<strong>パートナー名</strong>
                    のどちらかを{KEYWORD_MIN_LENGTH}文字以上入力する
                  </li>
                </ul>
                <p className="ga-gate__note">{missingCondition()}</p>
              </div>
            ) : sortedRows.length === 0 ? (
              <p className="ga-empty">
                条件に合う案件がありません。絞り込みを緩めてください。
              </p>
            ) : (
              <>
                {/* 件数と金額のサマリ */}
                <div className="ga-summary">
                  <div className="ga-summary__main">
                    <span className="ga-summary__count">
                      {sortedRows.length.toLocaleString()}
                    </span>
                    <span className="ga-summary__unit">件</span>
                    <span className="ga-summary__total">
                      / 全 {allRows.length.toLocaleString()} 件
                    </span>
                  </div>
                  <dl className="ga-summary__stats">
                    <div>
                      <dt>パートナー数</dt>
                      <dd>{summary.partners.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>コマ合計</dt>
                      <dd>{summary.slots.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>売上/月</dt>
                      <dd>{summary.sales.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>粗利/月</dt>
                      <dd className={summary.profit < 0 ? "is-negative" : ""}>
                        {summary.profit.toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt>粗利率</dt>
                      <dd>{formatRate(summary.margin) || "-"}</dd>
                    </div>
                  </dl>
                </div>

                {/* 内訳 */}
                <div className="ga-breakdown">
                  <div className="ga-breakdown__head">
                    <h2 className="ga-breakdown__title">内訳</h2>
                    <label className="ga-breakdown__metric">
                      並び順
                      <select
                        value={breakdownMetric}
                        onChange={(e) => setBreakdownMetric(e.target.value)}
                      >
                        {BREAKDOWN_METRICS.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}順
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="ga-breakdown__tabs">
                    {BREAKDOWN_DIMENSIONS.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        className={`ga-breakdown__tab${
                          d.key === breakdownKey ? " is-on" : ""
                        }`}
                        onClick={() => {
                          setBreakdownKey(d.key);
                          setShowAllBreakdown(false);
                        }}
                        aria-pressed={d.key === breakdownKey}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>

                  <div className="anken-table-scroll">
                    <table className="anken-table ga-breakdown__table">
                      <thead>
                        <tr>
                          <th className="cell col-m">
                            {
                              BREAKDOWN_DIMENSIONS.find((d) => d.key === breakdownKey)
                                ?.label
                            }
                          </th>
                          <th className="cell col-xs right">件数</th>
                          <th className="cell col-xs right">コマ</th>
                          <th className="cell col-s right">売上/月</th>
                          <th className="cell col-s right">粗利/月</th>
                          <th className="cell col-xs right">粗利率</th>
                          <th className="cell col-xs right">構成比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownRows.map((entry) => {
                          const label = breakdownDimension?.format
                            ? breakdownDimension.format(entry.value) || entry.value
                            : entry.value;
                          const barWidth = breakdownMax
                            ? (entry[breakdownMetric] / breakdownMax) * 100
                            : 0;
                          const isDrilled = drill?.value === entry.value;
                          return (
                            <tr
                              key={entry.value}
                              className={`ga-breakdown__row${
                                isDrilled ? " is-on" : drill ? " is-dim" : ""
                              }`}
                              role="button"
                              tabIndex={0}
                              aria-pressed={isDrilled}
                              title={
                                isDrilled
                                  ? "もう一度押すと解除します"
                                  : "この行で明細を絞り込みます"
                              }
                              onClick={() => toggleDrill(entry.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleDrill(entry.value);
                                }
                              }}
                            >
                              <td className="cell col-m wrap ga-breakdown__name">
                                {/* 選んだ指標の大きさを背景の帯で見せる */}
                                <span
                                  className="ga-breakdown__bar"
                                  style={{ width: `${barWidth}%` }}
                                  aria-hidden="true"
                                />
                                <span className="ga-breakdown__text">{label}</span>
                              </td>
                              <td className="cell col-xs nowrap right">
                                {entry.count.toLocaleString()}
                              </td>
                              <td className="cell col-xs nowrap right">
                                {entry.slots.toLocaleString()}
                              </td>
                              <td className="cell col-s nowrap right">
                                {entry.sales.toLocaleString()}
                              </td>
                              <td
                                className={`cell col-s nowrap right ${
                                  entry.profit < 0 ? "is-negative" : ""
                                }`}
                              >
                                {entry.profit.toLocaleString()}
                              </td>
                              <td className="cell col-xs nowrap right">
                                {formatRate(entry.margin) || "-"}
                              </td>
                              <td className="cell col-xs nowrap right">
                                {formatRate(entry.share * 100) || "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {hiddenBreakdownCount > 0 && (
                    <button
                      type="button"
                      className="ga-breakdown__more"
                      onClick={() => setShowAllBreakdown(true)}
                    >
                      残り {hiddenBreakdownCount.toLocaleString()} 件を表示
                    </button>
                  )}
                  {showAllBreakdown && breakdown.length > BREAKDOWN_LIMIT && (
                    <button
                      type="button"
                      className="ga-breakdown__more"
                      onClick={() => setShowAllBreakdown(false)}
                    >
                      上位{BREAKDOWN_LIMIT}件に戻す
                    </button>
                  )}
                </div>

                {drill && (
                  <div className="ga-drill">
                    <span className="ga-drill__text">
                      {breakdownDimension?.label}：
                      <strong>
                        {breakdownDimension?.format
                          ? breakdownDimension.format(drill.value) || drill.value
                          : drill.value}
                      </strong>
                      {" "}で明細を絞り込み中
                    </span>
                    <button
                      type="button"
                      className="clear-btn"
                      onClick={() => setDrill(null)}
                    >
                      解除
                    </button>
                  </div>
                )}

                <div className="ga-list-info">
                  {startIndex}–{endIndex} / {sortedRows.length.toLocaleString()} 件
                </div>

                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onChange={handlePageChange}
                />

                {/* カード表示ではヘッダをクリックできないので、並び替えを別に出す */}
                {isNarrow && (
                  <div className="anken-sort">
                    <label className="anken-sort__label">
                      並び替え
                      <select
                        value={sortConfig.key || ""}
                        onChange={(e) =>
                          setSortConfig((prev) => ({
                            ...prev,
                            key: e.target.value || null,
                          }))
                        }
                      >
                        <option value="">指定なし</option>
                        {HEADERS.map((h) => (
                          <option key={h.key} value={h.key}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="anken-sort__order"
                      onClick={() =>
                        setSortConfig((prev) => ({
                          ...prev,
                          direction: prev.direction === "asc" ? "desc" : "asc",
                        }))
                      }
                      disabled={!sortConfig.key}
                    >
                      {sortConfig.direction === "asc" ? "▲ 昇順" : "▼ 降順"}
                    </button>
                  </div>
                )}

                {isNarrow ? (
                  <div className="anken-cards">
                    {pageRows.map((row) => (
                      <div
                        className={`anken-card ${contractTypeClass(row)}`}
                        key={row["Id"]}
                      >
                        {/* 上段：主管・支店・区分・コマ・拘束。
                            区分は大きさを他と揃え、色だけで見分けさせる */}
                        <div className="anken-card__tags ga-card-top">
                          <span className="anken-tag">
                            {groupLabel(row["Group_FY22__c"]) || "主管不明"}
                          </span>
                          {row["Branch__c"] && (
                            <span className="anken-tag">{row["Branch__c"]}</span>
                          )}
                          {row["Partner_Keiyaku_type_temp__c"] && (
                            <span className={`anken-tag ga-type ${contractTypeClass(row)}`}>
                              {row["Partner_Keiyaku_type_temp__c"]}
                            </span>
                          )}
                          <span className="anken-tag">
                            {row["KADO_YOTEI_NISSUU_AUTO__c"] || 0}コマ
                          </span>
                          <span className="anken-tag">
                            拘束 {formatHours(workHours(row))}
                          </span>
                        </div>

                        <div className="anken-card__head">
                          <div className="anken-card__partner">
                            {renderCell({ key: "Name" }, row)}
                          </div>
                          <div
                            className={`anken-card__rate ${
                              toNumber(row["Yotei_Arari_Keisan__c"]) < 0 ? "is-negative" : ""
                            }`}
                          >
                            <span className="anken-card__rate-label">粗利率</span>
                            {formatRate(grossMarginPct(row)) || "-"}
                          </div>
                        </div>

                        <div className="anken-card__project">
                          <span className="anken-card__label">パートナー</span>
                          {renderCell({ key: "Partner__r.Name" }, row)}
                        </div>

                        <div className="anken-card__money">
                          {[
                            { label: "売上/月", key: "Scheduled_sales_calculation__c" },
                            { label: "原価/月", key: "Yotei_Genka_keisan__c" },
                            { label: "粗利/月", key: "Yotei_Arari_Keisan__c" },
                          ].map(({ label, key }) => (
                            <div key={key}>
                              <span className="anken-card__label">{label}</span>
                              <span
                                className={
                                  key === "Yotei_Arari_Keisan__c" &&
                                  toNumber(row[key]) < 0
                                    ? "is-negative"
                                    : ""
                                }
                              >
                                {formatMoney(row[key]) || "-"}
                              </span>
                              <span className="ga-sub">
                                （{formatComputed(perDay(row, key), "/日")}）
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="ga-card-hourly">
                          <span className="anken-card__label">売上/時</span>
                          <span className="ga-card-hourly__value">
                            {formatComputed(salesPerHour(row))}
                          </span>
                        </div>

                        <div className="anken-card__start">
                          {formatArea(row) || "稼働地不明"}
                          <br />
                          {row["OperationStartDate__c"] || "開始日不明"} 〜{" "}
                          {formatEndDate(row["OperationEndDate__c"]) || "不明"}
                          <br />
                          {formatWorkingDays(row["WorkingDay__c"]) || "曜日不明"}{" "}
                          {formatTime(row["OperationStartTime__c"])}
                          {row["OperationEndTime__c"] &&
                            `〜${formatTime(row["OperationEndTime__c"])}`}
                        </div>

                        {row["Haisyasinsei_komento__c"] && (
                          <div className="anken-card__comment">
                            {row["Haisyasinsei_komento__c"]}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="anken-table-scroll">
                    <table className="anken-table">
                      <thead>
                        <tr>
                          {HEADERS.map((h) => (
                            <th
                              key={h.key}
                              className={`cell th-click ${h.w || ""} ${h.right ? "right" : ""}`}
                              onClick={() => handleSort(h.key)}
                              title="クリックで並び替え"
                            >
                              {h.label}
                              {sortConfig.key === h.key &&
                                (sortConfig.direction === "asc" ? " ▲" : " ▼")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((row) => (
                          <tr key={row["Id"]}>
                            {HEADERS.map((h) => (
                              <td
                                key={h.key}
                                className={`cell ${h.w || ""} ${
                                  h.wrap ? "wrap" : "nowrap"
                                } ${h.right ? "right" : ""}`}
                              >
                                {renderCell(h, row)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onChange={handlePageChange}
                />
              </>
            )}
          </>
        )}
      </div>

      <ScrollTopButton />
      {/* 先に「更新日時」だけを読み、シートが書き換わっていなければ取り直さない */}
      <PullToRefresh
        onRefresh={async () => {
          await syncSheetCaches();
          await loadData({ silent: true });
        }}
      />
    </div>
  );
};

export default GeneralAnalysisPage;
