// AvailabilityPage.js

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./SearchPage.css";
import ReactSlider from "react-slider";
import HeaderMenu from "./HeaderMenu";
import LocationSelectorModal from "./LocationSelectorModal";
import SearchHistoryModal from "./SearchHistoryModal";
import SessionExpiredNotice from "./SessionExpiredNotice";
import Pagination from "./Pagination";
import ScrollTopButton from "./ScrollTopButton";
import PullToRefresh from "./PullToRefresh";
import ConfirmLink from "./ConfirmLink";
import { fetchPrefectureCityMap, buildCityCandidates, sanitizeCitySelection } from "../utils/locationOptions";
import { addSearchHistory } from "../utils/searchHistoryApi";
import { fetchSheetRows, isAuthError } from "../utils/sheetsApi";
import { syncSheetCaches } from "../utils/updatedAtApi";
import useDebouncedSave from "../utils/useDebouncedSave";

const RANGE_PARTNER = "パートナー情報!A1:ZZ";
const RANGE_ASSIGN = "稼働中案件!A1:ZZ";
const FILTER_CACHE_KEY = "availabilityFilters_v1";
const SEARCH_HISTORY_PAGE_KEY = "availability";

const weekdays = ["月", "火", "水", "木", "金", "土", "日"];
const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

const dayMap = {
  月曜日: "月",
  火曜日: "火",
  水曜日: "水",
  木曜日: "木",
  金曜日: "金",
  土曜日: "土",
  日曜日: "日",
  祝日: "祝",
};

const calculateDuration = (start, end) => {
  if (!start || !end) return "";
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  let startTotal = startH * 60 + startM;
  let endTotal = endH * 60 + endM;
  if (endTotal < startTotal) endTotal += 24 * 60; // 日跨ぎ
  const diffMinutes = endTotal - startTotal;
  const h = (diffMinutes / 60).toFixed(2);
  return `${parseFloat(h)}h`;
};

// 日付フォーマッタ
const formatDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

const ExpirationField = ({ label, value }) => {
  const today = new Date();
  const date = value ? new Date(value) : null;
  const expired = date ? date < new Date(today.toDateString()) : true;
  const display = date ? formatDate(value) : "なし";
  return (
    <p>
      {label}：{" "}
      <strong style={{ color: expired ? "#990000" : "#000000" }}>
        {display}
      </strong>
    </p>
  );
};

// ファイル先頭付近に配置
const LastWorkField = ({ status, lastWorked, lastProject, formatDate }) => {
  // ← フックは常に最初に呼ぶ（早期returnの前）
  const [open, setOpen] = React.useState(false);

  // 稼働中は表示しない（“–”を出したい場合は下の return を差し替え）
  if (status === "稼働") return null;

  return (
    <p style={{ display: "flex", alignItems: "center", gap: 6 }}>
      最終稼働日：
      <strong>{lastWorked ? formatDate(lastWorked) : "不明"}</strong>
      {lastProject && (
        <button
          type="button"
          className="info-dot"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="最終案件名を表示"
          style={{
            marginLeft: 4,
            width: 18,
            height: 18,
            lineHeight: "16px",
            textAlign: "center",
            borderRadius: "50%",
            border: "1px solid #007bff",
            color: "#007bff",
            background: "#fff",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          i
        </button>
      )}
      {open && lastProject && (
        <span style={{ marginLeft: 8, color: "#333", fontStyle: "italic" }}>
          {lastProject}
        </span>
      )}
    </p>
  );
};

/* ===== スケジュール表（1枚あたり 7×24=168セル） =====
   カード側の状態（お気に入り等）が変わっても作り直さないよう memo 化する。 */
const ScheduleTable = React.memo(function ScheduleTable({
  partner,
  orientation,
  weekSelections,
  timeFrom,
  timeTo,
}) {
  const isHorizontal = orientation === "horizontal";
  const rowHeaders = isHorizontal ? weekdays : hours;
  const colHeaders = isHorizontal ? hours : weekdays;

  // ループ内で毎回 parseInt / includes せず、事前に集合と数値に落としておく
  const selectedDays = React.useMemo(() => new Set(weekSelections), [weekSelections]);
  const from = parseInt(timeFrom, 10);
  const to = parseInt(timeTo, 10);

  return (
    <div className="partner-schedule-container">
      <div className="schedule-scroll">
        <table className={`schedule-table ${isHorizontal ? "horizontal" : "vertical"}`}>
          <thead>
            <tr>
              <th>{isHorizontal ? "曜/時" : "時/曜"}</th>
              {colHeaders.map((hdr) => (
                <th key={hdr}>{hdr}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rowHeaders.map((rowHdr) => (
              <tr key={rowHdr}>
                <td>{rowHdr}</td>

                {colHeaders.map((colHdr) => {
                  const day = isHorizontal ? rowHdr : colHdr;
                  const h = isHorizontal ? colHdr : rowHdr;
                  const key = `${day}_${h}`;
                  const val = partner[key] || "";

                  const hourNum = parseInt(h, 10);
                  const matching =
                    selectedDays.has(day) && hourNum >= from && hourNum <= to;

                  const classNames = [
                    val === "0" ? "inactive-cell" : val === "1" ? "active-cell" : "",
                    matching ? "matching-cell" : "",
                  ]
                    .join(" ")
                    .trim();

                  const displayVal = val === "0" ? "空" : val === "1" ? "稼" : "";

                  return (
                    <td key={key} className={classNames}>
                      {displayVal}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

const PAGE_SIZE = 20;
const EMPTY_ASSIGNMENTS = [];

const AvailabilityPage = () => {
  const savedFilters = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(FILTER_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.error("Failed to read availability filters from cache", error);
      return null;
    }
  }, []);

  const pickArray = (key, fallback) => {
    if (savedFilters && Array.isArray(savedFilters[key])) {
      return [...savedFilters[key]];
    }
    return fallback;
  };

  const pickString = (key, fallback) => {
    if (savedFilters && typeof savedFilters[key] === "string") {
      return savedFilters[key];
    }
    return fallback;
  };

  const pickBoolean = (key, fallback) => {
    if (savedFilters && typeof savedFilters[key] === "boolean") {
      return savedFilters[key];
    }
    return fallback;
  };
  /* ▼ 住所：モーダル＋複数選択 ▼ */
  const [areaMap, setAreaMap] = useState({}); // {pref: [city,...]}
  const [selectedPrefs, setSelectedPrefs] = useState(() => pickArray("selectedPrefs", [])); // 都道府県（複数）
  const [selectedDistricts, setSelectedDistricts] = useState(() => pickArray("selectedDistricts", [])); // 市区町村（複数）

  const [locationModalType, setLocationModalType] = useState(null); // 都道府県/市区町村モーダル

  // お気に入り
  const [favoriteIds, setFavoriteIds] = useState([]);
  
  // お気に入りだけで検索するフラグ

  const [showFavoritesOnly, setShowFavoritesOnly] = useState(() => pickBoolean("showFavoritesOnly", false));

  // 初期化：localStorage からお気に入りを復元
  useEffect(() => {
    const saved = localStorage.getItem("favoritePartners");
    if (saved) {
      setFavoriteIds(JSON.parse(saved));
    }
  }, []);

  // お気に入り切り替え
  const toggleFavorite = useCallback((id) => {
    setFavoriteIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((fid) => fid !== id)
        : [...prev, id];
      localStorage.setItem("favoritePartners", JSON.stringify(next));
      return next;
    });
  }, []);

  // モーダル
  /* ▲ */

  const [weekSelections, setWeekSelections] = useState(() => pickArray("weekSelections", []));
  const [timeFrom, setTimeFrom] = useState(() => pickString("timeFrom", "09"));
  const [timeTo, setTimeTo] = useState(() => pickString("timeTo", "18"));
  const [statusFilter, setStatusFilter] = useState(() => pickArray("statusFilter", ["稼働", "未稼働"]));
  const [strictMatch, setStrictMatch] = useState(() => pickBoolean("strictMatch", false));

  const [partners, setPartners] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const partnersReadyRef = useRef(false);
  // 前回の条件を復元する場合は、最初から「検索待ち」状態にしておく。
  // データが届いた時点で下の effect が拾って実行する。
  const pendingSearchRef = useRef(
    savedFilters && savedFilters.hasSearched
      ? { favoritesOnly: !!savedFilters.showFavoritesOnly }
      : null
  );

  // パートナーIDごとの案件索引。
  // カード描画のたびに assignments 全件を filter していたのを1回のグルーピングに置き換える。
  const assignmentsByPartner = useMemo(() => {
    const map = new Map();
    assignments.forEach((a) => {
      const key = a["Partner__r.ID_18__c"];
      if (!key) return;
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    });
    return map;
  }, [assignments]);

  const [filteredPartners, setFilteredPartners] = useState([]);
  const [rawFilteredPartners, setRawFilteredPartners] = useState([]);

  // 並び替え
  const [sortKey, setSortKey] = useState(() => pickString("sortKey", "Name"));
  const [sortOrder, setSortOrder] = useState(() => pickString("sortOrder", "asc"));
//  const restoredSearchRef = useRef(false);


  // ページング
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredPartners.length / PAGE_SIZE)),
    [filteredPartners.length]
  );
  const pagedPartners = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPartners.slice(start, start + PAGE_SIZE);
  }, [filteredPartners, currentPage]);
  const startIndex = useMemo(
    () => (filteredPartners.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0),
    [filteredPartners.length, currentPage]
  );
  const endIndex = useMemo(
    () => Math.min(currentPage * PAGE_SIZE, filteredPartners.length),
    [filteredPartners.length, currentPage]
  );

  // 表の向き
  const [tableOrientation, setTableOrientation] = useState(() => {
    if (
      savedFilters &&
      (savedFilters.tableOrientation === "vertical" ||
        savedFilters.tableOrientation === "horizontal")
    ) {
      return savedFilters.tableOrientation;
    }
    return window.innerWidth <= 640 ? "vertical" : "horizontal";
  });

  // 年齢レンジ
  const [ageMin, setAgeMin] = useState(() => pickString("ageMin", ""));
  const [ageMax, setAgeMax] = useState(() => pickString("ageMax", ""));

  // ガイダンス＆ローディング
  // 前回検索していたなら、データ到着後に同じ条件で自動的に検索し直す
  const restoreSearch = Boolean(savedFilters && savedFilters.hasSearched);
  const [hasSearched, setHasSearched] = useState(restoreSearch);
  const [isLoading, setIsLoading] = useState(restoreSearch);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  // 検索パネルの開閉（検索して結果が出たら畳む）
  const [panelOpen, setPanelOpen] = useState(true);

  // 畳んだときに表示する条件サマリ
  const searchSummary = useMemo(() => {
    const parts = [];
    if (showFavoritesOnly) parts.push("⭐ お気に入りのみ");
    if (selectedPrefs.length) parts.push(selectedPrefs.join("・"));
    if (selectedDistricts.length) {
      parts.push(
        selectedDistricts.length > 3
          ? `${selectedDistricts.slice(0, 3).join("・")} 他${selectedDistricts.length - 3}件`
          : selectedDistricts.join("・")
      );
    }
    if (weekSelections.length) {
      parts.push(`${weekSelections.join("")}${strictMatch ? "（全曜日空車）" : ""}`);
    }
    parts.push(`${timeFrom}:00〜${timeTo}:00`);
    if (ageMin !== "" || ageMax !== "") {
      parts.push(`${ageMin || "下限なし"}〜${ageMax || "上限なし"}歳`);
    }
    if (statusFilter.length && statusFilter.length < 2) parts.push(statusFilter.join("・"));
    return parts.length ? parts.join(" ｜ ") : "条件指定なし";
  }, [
    showFavoritesOnly,
    selectedPrefs,
    selectedDistricts,
    weekSelections,
    strictMatch,
    timeFrom,
    timeTo,
    ageMin,
    ageMax,
    statusFilter,
  ]);


  // 検索条件のキャッシュ。年齢やキーワードを1文字打つたびに
  // 同期書き込みが走らないよう、入力が落ち着いてから保存する。
  useDebouncedSave(FILTER_CACHE_KEY, {
    selectedPrefs,
    selectedDistricts,
    weekSelections,
    timeFrom,
    timeTo,
    ageMin,
    ageMax,
    statusFilter,
    strictMatch,
    sortKey,
    sortOrder,
    tableOrientation,
    showFavoritesOnly,
    hasSearched,
  });

  const [errorMessage, setErrorMessage] = useState("");
  const [authExpired, setAuthExpired] = useState(false);

  const userEmail = localStorage.getItem("userEmail") || "未取得";
  const effectiveUserId = userEmail && userEmail !== "未取得" ? userEmail : "";

  /* ===== データ取得（sheetsApi 側でキャッシュされるため再訪時は即時） ===== */
  const loadData = useCallback(async ({ force = false } = {}) => {
    partnersReadyRef.current = false;
    setAuthExpired(false);
    setErrorMessage("");

    const results = await Promise.allSettled([
      fetchSheetRows(RANGE_PARTNER, { force }),
      fetchSheetRows(RANGE_ASSIGN, { force }),
      fetchPrefectureCityMap({ force }),
    ]);
    const [partnerResult, assignResult, areaResult] = results;

    if (partnerResult.status === "fulfilled") {
      setPartners(partnerResult.value);
    } else {
      setPartners([]);
    }
    if (assignResult.status === "fulfilled") {
      setAssignments(assignResult.value);
    }
    if (areaResult.status === "fulfilled") {
      setAreaMap(areaResult.value);
    }

    partnersReadyRef.current = true;

    const failures = results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason);
    if (failures.some(isAuthError)) {
      // 「該当なし」に見せないよう、認証切れは明示する
      setAuthExpired(true);
    } else if (failures.length) {
      console.error("データ取得に失敗:", failures);
      setErrorMessage("データの取得に失敗しました。時間をおいて再試行してください。");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 候補生成（県＝全キー／市区町村＝選択県の合算。未選択時は全県合算）
  const allPrefList = useMemo(() => Object.keys(areaMap), [areaMap]);
  const cityCandidates = useMemo(
    () => buildCityCandidates(areaMap, selectedPrefs),
    [areaMap, selectedPrefs]
  );

  // 県変更時：候補外の市区町村は自動除外
  useEffect(() => {
    if (!areaMap || !Object.keys(areaMap).length) return;
    setSelectedDistricts((prev) =>
      sanitizeCitySelection(areaMap, selectedPrefs, prev)
    );
  }, [areaMap, selectedPrefs]);

  /* ===== 並び替え ===== */
  // 並び替え関数はuseCallbackでラップ
  const sortPartners = React.useCallback((partnersToSort, key, order) => {
    const dir = order === "asc" ? 1 : -1;

    return [...partnersToSort].sort((a, b) => {
      // 1) お気に入り並び替え
      if (key === "favorite") {
        const favA = favoriteIds.includes(a["SF_ID__c"]);
        const favB = favoriteIds.includes(b["SF_ID__c"]);

        if (favA !== favB) {
          // 昇順(asc)＝⭐優先、降順(desc)＝⭐後回し
          return favA ? -1 * dir : 1 * dir;
        }
        // ⭐同士/非⭐同士のタイブレークは「名前」
        const nameA = String(a["Name"] || "");
        const nameB = String(b["Name"] || "");
        return nameA.localeCompare(nameB) * 1; // タイブレークは常に昇順
      }

      // 2) 通常キー
      const valA = a[key] || "";
      const valB = b[key] || "";

      if (key === "Now_Age__c") {
        return (Number(valA) - Number(valB)) * dir;
      } else if (key === "ApprovalDate__c" || key === "最終稼働日") {
        const dA = valA ? new Date(valA).getTime() : 0;
        const dB = valB ? new Date(valB).getTime() : 0;
        return (dA - dB) * dir;
      } else {
        return String(valA).localeCompare(String(valB)) * dir;
      }
    });
  }, [favoriteIds]);

  useEffect(() => {
    setFilteredPartners(sortPartners(rawFilteredPartners, sortKey, sortOrder));
  }, [sortKey, sortOrder, rawFilteredPartners, sortPartners]);

  // 件数が変わったら currentPage を範囲内に補正
  useEffect(() => {
    setCurrentPage((p) => {
      const newTotal = Math.max(
        1,
        Math.ceil(filteredPartners.length / PAGE_SIZE)
      );
      return Math.min(p, newTotal);
    });
  }, [filteredPartners]);

  /* ===== ステータス ===== */
  const handleStatusChange = (status) => {
    setStatusFilter((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  };

  /* ===== 検索 ===== */

  const handleSearch = (favoritesOnly = false) => {
    // お気に入り検索フラグを同期
    setShowFavoritesOnly(favoritesOnly);


    setErrorMessage("");
    setHasSearched(true);

    if (!partnersReadyRef.current) {
      pendingSearchRef.current = { favoritesOnly };
      setIsLoading(true);
      return;
    }

    pendingSearchRef.current = null;
    setIsLoading(true);

    const from = parseInt(timeFrom);
    const to = parseInt(timeTo);
    const days = weekSelections; // ← 空なら空車判定は適用しない
    // 対象時間帯はパートナーごとに変わらないので、ループの外で1回だけ組み立てる
    const targetHours = hours.filter((_, i) => i >= from && i <= to);
    const statusSet = new Set(statusFilter);
    const prefSet = new Set(selectedPrefs);
    const districtSet = new Set(selectedDistricts);
    const favoriteSet = new Set(favoriteIds);
    const searchParamsSnapshot = {
      selectedPrefs: [...selectedPrefs],
      selectedDistricts: [...selectedDistricts],
      weekSelections: [...weekSelections],
      timeFrom,
      timeTo,
      ageMin,
      ageMax,
      statusFilter: [...statusFilter],
      strictMatch,
      favoritesOnly,
      sortKey,
      sortOrder,
    };

    const keywordSummaryParts = [];
    if (favoritesOnly) keywordSummaryParts.push("お気に入りのみ");
    if (selectedPrefs.length) keywordSummaryParts.push(`都道府県:${selectedPrefs.join("/")}`);
    if (selectedDistricts.length) keywordSummaryParts.push(`市区町村:${selectedDistricts.join("/")}`);
    if (weekSelections.length) keywordSummaryParts.push(`曜日:${weekSelections.join("/")}`);
    const keywordLabel = keywordSummaryParts.join(" | ");
    const pageUrl = typeof window !== "undefined" ? window.location.pathname : "";
    const startedAt = performance.now();


    setTimeout(() => {
      const result = partners.filter((p) => {
        // ★お気に入りのみ → ID が含まれていなければ除外
        if (favoritesOnly && !favoriteSet.has(p["SF_ID__c"])) return false;

        // 離脱などは共通で除外
        if (p["Name"]?.includes("支援終了") || p["Name"]?.includes("離脱"))
          return false;

        // ステータス（稼働/未稼働）フィルタは共通で適用
        if (!statusSet.has(p["OperatingStatus__c"])) return false;

        // 都道府県 / 市区町村は、選択がある場合のみ適用（未選択なら素通し）
        if (prefSet.size && !prefSet.has(p["都道府県"])) return false;
        if (districtSet.size && !districtSet.has(p["市区町村"])) return false;

        // 年齢も、境界が指定されている場合のみ適用
        const hasAgeBound = ageMin !== "" || ageMax !== "";
        if (hasAgeBound) {
          const ageNum = Number(p["Now_Age__c"]);
          const minOk = ageMin === "" ? true : ageNum >= Number(ageMin);
          const maxOk = ageMax === "" ? true : ageNum <= Number(ageMax);
          if (Number.isNaN(ageNum) || !(minOk && maxOk)) return false;
        }

        // 空車ロジック：曜日が選ばれている時だけ判定（空ならスキップ＝全通し）
        if (days.length > 0) {
          const isDayFullyFree = (day) =>
            targetHours.every((h) => (p[`${day}_${h}`] || "").trim() === "0");

          if (strictMatch) {
            if (!days.every((d) => isDayFullyFree(d))) return false;
          } else {
            if (!days.some((d) => isDayFullyFree(d))) return false;
          }
        }

        return true;
      });

      setRawFilteredPartners(result);
      setFilteredPartners(sortPartners(result, sortKey, sortOrder));
      setCurrentPage(1);
      setIsLoading(false);
      // 結果があるときだけ畳む。0件なら条件を直したいはずなので開いたままにする
      setPanelOpen(result.length === 0);

      if (effectiveUserId) {
        const elapsed = Math.round(performance.now() - startedAt);
        addSearchHistory({
          userId: effectiveUserId,
          pageKey: SEARCH_HISTORY_PAGE_KEY,
          searchParams: searchParamsSnapshot,
          executedAt: new Date().toISOString(),
          resultCount: result.length,
          elapsedMs: elapsed,
          pageUrl,
          keyword: keywordLabel || undefined,
        }).catch((error) => {
          console.error("検索履歴の保存に失敗しました", error);
        });
      }

    }, 0);
  };

  // データ到着前に検索が押された場合、到着後に自動で実行する
  // （これが無いと「検索中...」のまま止まってしまう）
  useEffect(() => {
    if (!partnersReadyRef.current) return;
    if (!pendingSearchRef.current) return;
    const { favoritesOnly } = pendingSearchRef.current;
    pendingSearchRef.current = null;
    handleSearch(favoritesOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners]);

  /* ===== モーダル制御 ===== */
  const openLocationModal = (type) => {
    setLocationModalType(type);
  };

  const closeLocationModal = () => {
    setLocationModalType(null);
  };

  const handleApplyLocationModal = (values) => {
    if (!locationModalType) return;
    if (locationModalType === "pref") {
      setSelectedPrefs(values);
      setSelectedDistricts((prev) => sanitizeCitySelection(areaMap, values, prev));
    } else if (locationModalType === "city") {
      setSelectedDistricts(values);
    }
    setLocationModalType(null);
  };

  const summary = (label, arr) =>
    `${label}${arr.length ? `（${arr.length}件選択）` : "（未選択）"}`;

  const applyHistoryParams = (params = {}) => {
    if (!params || typeof params !== "object") return;
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(params, key);
    const normalizeTime = (value) => {
      if (value === undefined || value === null) return undefined;
      const str = String(value).trim();
      if (!str) return "00";
      const num = Number(str);
      return Number.isNaN(num) ? str : num.toString().padStart(2, "0");
    };

    if (Array.isArray(params.selectedPrefs)) {
      setSelectedPrefs([...params.selectedPrefs]);
    }
    if (Array.isArray(params.selectedDistricts)) {
      setSelectedDistricts([...params.selectedDistricts]);
    }
    if (Array.isArray(params.weekSelections)) {
      setWeekSelections([...params.weekSelections]);
    }
    if (hasOwn("timeFrom")) {
      const normalized = normalizeTime(params.timeFrom);
      if (normalized !== undefined) {
        setTimeFrom(normalized);
      }
    }
    if (hasOwn("timeTo")) {
      const normalized = normalizeTime(params.timeTo);
      if (normalized !== undefined) {
        setTimeTo(normalized);
      }
    }
    if (hasOwn("ageMin")) {
      setAgeMin(
        params.ageMin === undefined || params.ageMin === null ? "" : String(params.ageMin)
      );
    }
    if (hasOwn("ageMax")) {
      setAgeMax(
        params.ageMax === undefined || params.ageMax === null ? "" : String(params.ageMax)
      );
    }
    if (Array.isArray(params.statusFilter)) {
      setStatusFilter([...params.statusFilter]);
    }
    if (hasOwn("strictMatch")) {
      setStrictMatch(!!params.strictMatch);
    }
    if (hasOwn("favoritesOnly")) {
      setShowFavoritesOnly(!!params.favoritesOnly);
    }
    if (typeof params.sortKey === "string" && params.sortKey) {
      setSortKey(params.sortKey);
    }
    if (typeof params.sortOrder === "string" && params.sortOrder) {
      setSortOrder(params.sortOrder);
    }
  };

  const handleApplyHistoryOnly = (params = {}) => {
    applyHistoryParams(params);
  };

  const handleApplyHistoryWithSearch = (params = {}) => {
    applyHistoryParams(params);
    const hasFavoritesFlag = Object.prototype.hasOwnProperty.call(
      params || {},
      "favoritesOnly"
    );
    const favoritesFlag = hasFavoritesFlag ? !!params.favoritesOnly : false;
    setTimeout(() => handleSearch(favoritesFlag), 0);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <HeaderMenu title="空車情報検索（個人事業主）" />

      <div className="availability-page">
        <ScrollTopButton />
        {/* 先に「更新日時」だけを読み、シートが書き換わっていなければ取り直さない */}
        <PullToRefresh
          onRefresh={async () => {
            await syncSheetCaches();
            await loadData();
          }}
        />

        {authExpired && <SessionExpiredNotice onRetry={() => loadData({ force: true })} />}

        {/* 検索後はパネルを畳み、条件サマリだけ見せて結果を前に出す */}
        {!panelOpen && (
          <div className="search-summary">
            <div className="search-summary__text">{searchSummary}</div>
            <button
              type="button"
              className="search-summary__toggle"
              onClick={() => setPanelOpen(true)}
            >
              条件を変更
            </button>
          </div>
        )}

        {panelOpen && (
        <div className="search-panel">
          {/* 住所：チップ → モーダル複数選択 */}
          <div style={{ marginTop: 4 }}>
            <div style={styles.chipRow}>
              <button
                className="chip-like"
                style={styles.chip}
                onClick={() => openLocationModal("pref")}
              >
                {summary("都道府県", selectedPrefs)}
              </button>
              <button
                className="chip-like"
                style={styles.chip}
                onClick={() => openLocationModal("city")}
              >
                {summary("市区町村", selectedDistricts)}
              </button>
            </div>
            <div style={styles.hint}>
              ※ 都道府県・市区町村ともに複数選択可。
            </div>
          </div>

          {/* 曜日 */}
          <div className="city-and-weekdays">
            <div className="weekday-section">
              <div className="weekday-presets">
                <button
                  onClick={() =>
                    setWeekSelections(["月", "火", "水", "木", "金"])
                  }
                >
                  平日
                </button>
                <button onClick={() => setWeekSelections(["土", "日"])}>
                  土日
                </button>
                <button
                  onClick={() =>
                    setWeekSelections([
                      "月",
                      "火",
                      "水",
                      "木",
                      "金",
                      "土",
                      "日",
                    ])
                  }
                >
                  全日
                </button>

<button
  className="weekday-clear"
  onClick={() => setWeekSelections([])}
  disabled={weekSelections.length === 0}
>
  クリア
</button>

              </div>

              <div className="weekday-checkboxes-inline">
                {weekdays.map((day) => {
                  const isSelected = weekSelections.includes(day);
                  return (
                    <label
                      key={day}
                      className={`weekday-btn ${isSelected ? "selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          setWeekSelections((prev) =>
                            prev.includes(day)
                              ? prev.filter((d) => d !== day)
                              : [...prev, day]
                          )
                        }
                      />
                      {day}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 時間帯スライダー＋開始/終了 */}
          <div className="time-range-section">
            <ReactSlider
              className="time-slider"
              thumbClassName="thumb"
              trackClassName="track"
              min={0}
              max={23}
              value={[parseInt(timeFrom), parseInt(timeTo)]}
              onChange={([start, end]) => {
                setTimeFrom(start.toString().padStart(2, "0"));
                setTimeTo(end.toString().padStart(2, "0"));
              }}
              pearling
              minDistance={1}
              renderThumb={(props, state) => (
                <div {...props}>
                  <div className="thumb-label">{state.valueNow}:00</div>
                </div>
              )}
            />

            <div className="time-selects-row">
              <div className="time-select">
                <label>開始時間</label>
                <select
                  value={timeFrom}
                  onChange={(e) => setTimeFrom(e.target.value)}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {h}:00
                    </option>
                  ))}
                </select>
              </div>

              <div className="time-select">
                <label>終了時間</label>
                <select
                  value={timeTo}
                  onChange={(e) => setTimeTo(e.target.value)}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {h}:00
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 年齢レンジ */}
            <div className="age-range-section">
              <label className="age-label">年齢</label>
              <div className="age-input-row">
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="下限"
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value)}
                  className="age-input"
                />
                <span className="age-tilde">～</span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="上限"
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value)}
                  className="age-input"
                />
                
                <button
                  type="button"
                  className="clear-btn"
                  
                  onClick={() => {
                    setAgeMin("");
                    setAgeMax("");
                  }}
                  style={{ marginLeft: 8 }}
                  disabled={ageMin === "" && ageMax === ""}
                >
                  クリア
                </button>
              </div>
            </div>
          </div>

          {/* ステータス・全曜日空車 */}
          <div className="status-filters">
            <div className="status-checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={statusFilter.includes("稼働")}
                  onChange={() => handleStatusChange("稼働")}
                />
                稼働
              </label>
            </div>

            <div className="status-checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={statusFilter.includes("未稼働")}
                  onChange={() => handleStatusChange("未稼働")}
                />
                未稼働
              </label>
            </div>

            <div className="strict-match-filter">
              <label>
                <input
                  type="checkbox"
                  checked={strictMatch}
                  onChange={() => setStrictMatch(!strictMatch)}
                />
                全曜日空車
              </label>
            </div>
          </div>

          <div className="search-button-wrapper">
            {errorMessage && (
              <div className="error-message">{errorMessage}</div>
            )}

            <div className="search-button-wrapper">
              {/* 検索 */}
              <button className="search" onClick={() => handleSearch(false)}>
                通常検索
              </button>

              {/* ★お気に入り検索（未選択でも実行OK） */}
              <button
                className="favorite-search"
                onClick={() => handleSearch(true)}
                title="お気に入りにチェック済みのドライバーだけを表示"
              >
                ⭐ お気に入り表示（都道府県・条件無視）
              </button>

              <button
                className="history-button"
                type="button"
                onClick={() => setHistoryModalOpen(true)}
              >
                検索履歴
              </button>
            </div>
          </div>
          </div>
        )}

        {/* 表示設定と件数は検索条件ではないので、結果リストの直上に置く */}
        {hasSearched && !isLoading && !authExpired && (
          <div className="result-toolbar">
            <div className="result-toolbar__count">
              <strong>{filteredPartners.length}</strong> 件
              {filteredPartners.length > 0 && (
                <span className="result-toolbar__range">
                  （{startIndex}–{endIndex} 件を表示／{currentPage} / {totalPages}ページ）
                </span>
              )}
            </div>

            <div className="result-toolbar__controls">
              <div className="sort-controls">
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  aria-label="並び替え"
                >
                  <option value="Name">名前</option>
                  <option value="ApprovalDate__c">承認日</option>
                  <option value="Now_Age__c">年齢</option>
                  <option value="Address__c">住所</option>
                  <option value="Gender__c">性別</option>
                  <option value="最終稼働日">最終稼働日</option>
                  <option value="favorite">お気に入り</option>
                </select>

                <button
                  type="button"
                  className={`order-toggle ${sortOrder}`}
                  onClick={() =>
                    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
                  }
                >
                  {sortOrder === "asc" ? "▲ 昇順" : "▼ 降順"}
                </button>
              </div>

              <div className="table-orientation-controls">
                <span className="label">表の向き：</span>
                <button
                  type="button"
                  className={`seg ${
                    tableOrientation === "horizontal" ? "active" : ""
                  }`}
                  onClick={() => setTableOrientation("horizontal")}
                >
                  横方向
                  {/* 推奨は画面幅で変わるためCSSで出し分ける */}
                  <span className="seg-recommend seg-recommend--wide">（推奨）</span>
                </button>
                <button
                  type="button"
                  className={`seg ${
                    tableOrientation === "vertical" ? "active" : ""
                  }`}
                  onClick={() => setTableOrientation("vertical")}
                >
                  縦方向
                  <span className="seg-recommend seg-recommend--narrow">（推奨）</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 検索前の案内／検索中のローディング */}
        {!hasSearched && !isLoading && (
          <div className="presearch-hint">
            🔍 条件を指定して「検索」を押してください
          </div>
        )}
        {isLoading && (
          <div className="loading-box">
            <div className="spinner" />
            <div className="loading-text">検索中...</div>
          </div>
        )}

        {/* 検索結果・カード＆ページネーション（検索後＆結果ありのときだけ） */}
        {hasSearched &&
          !isLoading &&
          !authExpired &&
          (filteredPartners.length === 0 ? (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              該当するパートナーはいません
            </div>
          ) : (
            <>
              {/* 上のページネーション */}
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onChange={handlePageChange}
              />

              <div className="partner-cards">
                {pagedPartners.map((p) => {
                  const partnerId = p["SF_ID__c"];
                  const isFav = favoriteIds.includes(partnerId);
                  const partnerAssignments =
                    assignmentsByPartner.get(partnerId) || EMPTY_ASSIGNMENTS;
                  const bringInContractType = p["bring_in_contract_type__c"];
                  const ankenHistoryCountRaw = Number(p["Anken_Count_Rireki__c"] ?? 0);
                  const normalizedAnkenHistoryCount = Number.isNaN(ankenHistoryCountRaw)
                    ? 0
                    : ankenHistoryCountRaw;
                  const displayContractType =
                    bringInContractType === "C契約" && normalizedAnkenHistoryCount === 0
                      ? bringInContractType
                      : "B契約";
                  const vehicleShapeLabel = p["VehicleShape__c"] || "不明";
                  const formatTime = (timeStr) =>
                    timeStr ? timeStr.slice(0, 5) : "";

                  return (
                    <div
                      key={partnerId}
                      className={`partner-card ${isFav ? "favorite-card" : ""}`}
                    >
                      {/* 名前・住所・携帯は、そのカードを見ている間ずっと
                          画面に残るよう position:sticky で固定する */}
                      <div className="partner-card__sticky">
                          <h3
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            {/* お気に入りボタン */}
                            <button
                              onClick={() => toggleFavorite(partnerId)}
                              className={`favorite-btn ${
                                isFav ? "active" : ""
                              }`}
                              aria-label="お気に入り"
                            >
                              {isFav ? "⭐" : "☆"}
                            </button>
                            <div className="name-block">
                              <div className="kana-name">{p["Name__c"]}</div>
                              <ConfirmLink
                                href={`https://logiquest.lightning.force.com/lightning/r/Contact/${partnerId}/view`}
                                description={`${p["Name"]} さんのパートナー情報`}
                                className="name-link"
                              >
                                <strong>
                                  {p["Name"]}（{p["Now_Age__c"]}歳）【
                                  {p["Gender__c"]}性】
                                </strong>
                              </ConfirmLink>
                            </div>

                            {(p["taiou_joukyou__c"] ||
                              p["taioujoukyou_sapto__c"]) && (
                              <div className="info-tooltip">
                                <button
                                  type="button"
                                  className="info-trigger"
                                  aria-label="対応状況を表示"
                                >
                                  <span className="info-icon">ℹ️</span>
                                </button>
                                <div className="tooltip-content">
                                  {p["taiou_joukyou__c"] && (
                                    <p>
                                      <strong>対応状況（営業）:</strong>{" "}
                                      {p["taiou_joukyou__c"]}
                                    </p>
                                  )}
                                  {p["taioujoukyou_sapto__c"] && (
                                    <p>
                                      <strong>対応状況（主管長）:</strong>{" "}
                                      {p["taioujoukyou_sapto__c"]}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </h3>

                          <p>
                            <strong>{p["Address__c"]}</strong>
                          </p>

                          <p>
                            携帯番号：{" "}
                            {p["MobilePhone"] ? (
                              <strong>
                                <a href={`tel:${p["MobilePhone"]}`} className="phone-link">
                                  {p["MobilePhone"]}
                                </a>
                              </strong>
                            ) : (
                              <strong style={{ color: "#990000" }}>なし</strong>
                            )}
                          </p>
                      </div>

                      <div className="partner-info-grid">
                        <div>
                          {/* スティッキーヘッダー側に区切り線を入れたので、
                              ここの hr は不要 */}
                          <LastWorkField
                            status={p["OperatingStatus__c"]}
                            lastWorked={p["最終稼働日"]}
                            lastProject={p["最終案件名"]}
                            formatDate={formatDate}
                          />

                          <p>
                            管理担当(支店)：
                            <strong>
                              {p["AdministratorName__r.Name"] || "不明"}（
                              {p["Manage_Branch__c"] || "不明"}）
                            </strong>
                          </p>

                          <p>
                            ステータス：
                            <span
                              style={{
                                color:
                                  p["OperatingStatus__c"] === "稼働"
                                    ? "#0029e0ff"
                                    : p["OperatingStatus__c"] === "未稼働"
                                    ? "#990000"
                                    : "black",
                                fontWeight: "bold",
                              }}
                            >
                              {p["OperatingStatus__c"] || "不明"}
                            </span>
                          </p>

                          <p>
                            過去案件履歴：
                            <ConfirmLink
                              href={`https://logiquest.lightning.force.com/lightning/r/Contact/${partnerId}/related/Partner__r/view`}
                              description={`${p["Name"]} さんの過去案件履歴`}
                            >
                              <span
                                style={{
                                  color:
                                    p["Anken_Count_Rireki__c"] !== "0"
                                      ? "#0029e0ff"
                                      : p["Anken_Count_Rireki__c"] === "0"
                                      ? "#990000"
                                      : "black",
                                  fontWeight: "bold",
                                }}
                              >
                                {p["Anken_Count_Rireki__c"] + "件" || "不明"}
                              </span>
                            </ConfirmLink>
                          </p>

                          <p>
                            承認日：
                            <strong>
                              {p["ApprovalDate__c"]
                                ? (() => {
                                    const [y, m, d] =
                                      p["ApprovalDate__c"].split("-");
                                    return `${y}年${m.replace(
                                      /^0/,
                                      ""
                                    )}月${d.replace(/^0/, "")}日`;
                                  })()
                                : "不明"}
                            </strong>
                          </p>

                          <p>
                            区分/車両：
                            <strong
                              style={{
                                color: !p["VehicleShape__c"]
                                  ? "#990000"
                                  : "inherit",
                              }}
                            >
                              {`【${displayContractType}】 ${vehicleShapeLabel}`}
                            </strong>
                          </p>

                          <p>
                            車両登録番号：{" "}
                            {p["RegistrationNumber__c"] ? (
                              <strong>{p["RegistrationNumber__c"]}</strong>
                            ) : (
                              <strong style={{ color: "#990000" }}>なし</strong>
                            )}
                          </p>

                          <ExpirationField
                            label="車検満了日"
                            value={p["InspectionExpirationDate__c"]}
                          />
                          <ExpirationField
                            label="任意保険満了日"
                            value={p["InsuranceExpirationDate__c"]}
                          />
                          <ExpirationField
                            label="免許証有効期限"
                            value={p["LicenseRenewalFinal__c"]}
                          />

                          <p>
                            T番号：
                            {!p["Invoice_code__c"] ||
                            p["Invoice_code__c"] === "T" ? (
                              <span
                                style={{ color: "#990000", fontWeight: "bold" }}
                              >
                                登録なし
                              </span>
                            ) : (
                              <ConfirmLink
                                href={`https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=${p[
                                  "Invoice_code__c"
                                ].substring(1)}`}
                                serviceName="国税庁インボイス公表サイト"
                                description={`登録番号 ${p["Invoice_code__c"]} の公表情報`}
                              >
                                {p["Invoice_code__c"]}
                              </ConfirmLink>
                            )}
                          </p>

                          <p>
                            備考：<strong>{p["DriverSituation__c"]}</strong>
                          </p>

                          {partnerAssignments.map((a, i) => {
                            const days = (a["WorkingDay__c"] || "")
                              .split(";")
                              .map((d) => dayMap[d.trim()] || d)
                              .join(",");
                            return (
                              <div key={i} className="assignment-info">
                                <p
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                  }}
                                >
                                  <ConfirmLink
                                    href={`https://logiquest.lightning.force.com/lightning/r/Oppotunities__c/${a["Id"]}/view`}
                                    description={a["Name"] || "案件名不明"}
                                  >
                                    {a["Name"] || "案件名不明"}
                                  </ConfirmLink>
                                  {a["Haisyasinsei_komento__c"] && (
                                    <div className="info-tooltip">
                                      <button
                                        type="button"
                                        className="info-trigger"
                                        aria-label="配車承認申請者コメントを表示"
                                      >
                                        <span className="info-icon">ℹ️</span>
                                      </button>
                                      <div className="tooltip-content">
                                        配車承認申請者コメント：
                                        <br />
                                        {a["Haisyasinsei_komento__c"]}
                                      </div>
                                    </div>
                                  )}
                                </p>
                                <p>
                                  稼働地：{a["PrefecturesFree__c"]}
                                  {a["CityFree__c"]}
                                  <br />
                                  稼働開始：{a["OperationStartDate__c"]}～<br />
                                  稼働曜日：{days}（
                                  {a["KADO_YOTEI_NISSUU_AUTO__c"]}日）
                                  <br />
                                  稼働時間：
                                  {formatTime(a["OperationStartTime__c"])}～
                                  {formatTime(a["OperationEndTime__c"])}（
                                  {calculateDuration(
                                    formatTime(a["OperationStartTime__c"]),
                                    formatTime(a["OperationEndTime__c"])
                                  )}
                                  ）
                                  <br />
                                  請求単価：
                                  {Number(
                                    a["ContractPrice__c"] || 0
                                  ).toLocaleString()}
                                  円/{(a["BillingCategory__c"] || "").charAt(0)}
                                  <br />
                                  支払単価：
                                  {Number(
                                    a["ConsignmentPrice__c"] || 0
                                  ).toLocaleString()}
                                  円/
                                  {(a["BillingCategorys__c"] || "").charAt(0)}
                                  <br />
                                </p>
                              </div>
                            );
                          })}
                        </div>

                        {/* スケジュール表（168セル／枚。memo化して不要な再構築を避ける） */}
                        <ScheduleTable
                          partner={p}
                          orientation={tableOrientation}
                          weekSelections={weekSelections}
                          timeFrom={timeFrom}
                          timeTo={timeTo}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 下のページネーション */}
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onChange={handlePageChange}
              />
            </>
          ))}
      </div>

      {/* === 共通モーダル === */}
      <LocationSelectorModal
        key={locationModalType || "none"}
        isOpen={Boolean(locationModalType)}
        title={
          locationModalType === "pref"
            ? "都道府県を選択"
            : locationModalType === "city"
            ? "市区町村を選択"
            : ""
        }
        options={
          locationModalType === "pref" ? allPrefList : cityCandidates
        }
        selectedValues={
          locationModalType === "pref"
            ? selectedPrefs
            : selectedDistricts
        }
        onClose={closeLocationModal}
        onApply={handleApplyLocationModal}
        searchPlaceholder={
          locationModalType === "pref"
            ? "都道府県名を検索"
            : "市区町村名を検索"
        }
      />
      <SearchHistoryModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        userId={effectiveUserId}
        pageKey={SEARCH_HISTORY_PAGE_KEY}
        onApply={handleApplyHistoryOnly}
        onSearch={handleApplyHistoryWithSearch}
      />
    </>
  );
};

export default AvailabilityPage;

/* ===== 最低限のインラインスタイル（必要ならCSSへ移動） ===== */
const styles = {
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  chip: {
    border: "1px solid #ddd",
    borderRadius: 9999,
    padding: "8px 12px",
    background: "white",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    cursor: "pointer",
  },
  hint: { fontSize: 12, opacity: 0.75, marginTop: 6 },
};

