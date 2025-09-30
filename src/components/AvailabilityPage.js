// AvailabilityPage.js

import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./AvailabilityPage.css";
import { useNavigate } from "react-router-dom";
import ReactSlider from "react-slider";
import HeaderMenu from "./HeaderMenu";
import LocationSelectorModal from "./LocationSelectorModal";
import { fetchPrefectureCityMap, buildCityCandidates, sanitizeCitySelection } from "../utils/locationOptions";

const SPREADSHEET_ID = process.env.REACT_APP_SPREADSHEET_ID;
// const SHEET_PARTNER = "パートナー情報"; // 未使用のためコメントアウト
const SHEET_ASSIGN = "稼働中案件";

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

/* ===== Pagination（重複排除） ===== */
const Pagination = ({ currentPage, totalPages, onChange }) => {
  if (totalPages <= 1) return null;

  const buildItems = () => {
    const items = [];
    const maxButtons = 7;
    if (totalPages <= maxButtons) {
      for (let i = 1; i <= totalPages; i++) items.push(i);
    } else {
      const left = Math.max(2, currentPage - 1);
      const right = Math.min(totalPages - 1, currentPage + 1);
      items.push(1);
      if (left > 2) items.push("…");
      for (let i = left; i <= right; i++) items.push(i);
      if (right < totalPages - 1) items.push("…");
      items.push(totalPages);
    }
    return items;
  };

  return (
    <div className="pagination">
      <button
        className="page-btn"
        onClick={() => onChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
      >
        前へ
      </button>

      {buildItems().map((it, idx) =>
        it === "…" ? (
          <span key={`e-${idx}`} className="page-ellipsis">
            …
          </span>
        ) : (
          <button
            key={it}
            className={`page-btn ${it === currentPage ? "active" : ""}`}
            onClick={() => onChange(it)}
          >
            {it}
          </button>
        )
      )}

      <button
        className="page-btn"
        onClick={() => onChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
      >
        次へ
      </button>
    </div>
  );
};

const PAGE_SIZE = 20;

const AvailabilityPage = () => {
  /* ▼ 住所：モーダル＋複数選択 ▼ */
  const [areaMap, setAreaMap] = useState({}); // {pref: [city,...]}
  const [selectedPrefs, setSelectedPrefs] = useState([]); // 都道府県（複数）
  const [selectedDistricts, setSelectedDistricts] = useState([]); // 市区町村（複数）

  const [locationModalType, setLocationModalType] = useState(null); // 都道府県/市区町村モーダル

  // お気に入り
  const [favoriteIds, setFavoriteIds] = useState([]);
  
  // お気に入りだけで検索するフラグ
  // eslint-disable-next-line no-unused-vars
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // 初期化：localStorage からお気に入りを復元
  useEffect(() => {
    const saved = localStorage.getItem("favoritePartners");
    if (saved) {
      setFavoriteIds(JSON.parse(saved));
    }
  }, []);

  // お気に入り切り替え
  const toggleFavorite = (id) => {
    setFavoriteIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((fid) => fid !== id)
        : [...prev, id];
      localStorage.setItem("favoritePartners", JSON.stringify(next));
      return next;
    });
  };

  // モーダル
  /* ▲ */

  const [weekSelections, setWeekSelections] = useState([]);
  const [timeFrom, setTimeFrom] = useState("00");
  const [timeTo, setTimeTo] = useState("23");
  const [statusFilter, setStatusFilter] = useState(["稼働", "未稼働"]);
  const [strictMatch, setStrictMatch] = useState(false);

  const [partners, setPartners] = useState([]);
  // パートナーデータ取得
  useEffect(() => {
    const fetchPartners = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;
      try {
        // パートナー情報シート名は "パートナー情報" で仮定
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/パートナー情報!A1:ZZ`;
        const res = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const [header, ...rows] = res.data.values || [[]];
        const data = rows.map((row) => {
          const obj = {};
          header.forEach((col, i) => (obj[col] = row[i] ?? ""));
          return obj;
        });
        setPartners(data);
      } catch (e) {
        // データ取得失敗時は空配列
        setPartners([]);
      }
    };
    fetchPartners();
  }, []);
  const [assignments, setAssignments] = useState([]);

  const [filteredPartners, setFilteredPartners] = useState([]);
  const [rawFilteredPartners, setRawFilteredPartners] = useState([]);

  // 並び替え
  const [sortKey, setSortKey] = useState("Name");
  const [sortOrder, setSortOrder] = useState("asc");

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
  const [tableOrientation, setTableOrientation] = useState(() =>
    window.innerWidth <= 640 ? "vertical" : "horizontal"
  );

  // 年齢レンジ
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");

  // ガイダンス＆ローディング
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // スクロールトップ
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const navigate = useNavigate();
  const userEmail = localStorage.getItem("userEmail") || "未取得";
  const userNameOnly = userEmail.includes("@")
    ? userEmail.split("@")[0]
    : userEmail;

  const handleLogout = () => {
    // ログイン情報だけ削除（お気に入りは保持する）
    localStorage.removeItem("token");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userName");
    navigate("/");
  };

  const handleNavigateHome = () => {
    navigate("/home");
  };

  /* ===== 都道府県マスタ ===== */
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetchPrefectureCityMap({ token })
      .then(setAreaMap)
      .catch((error) => {
        console.error("都道府県マスタの取得に失敗:", error);
      });
  }, []);

  // 候補生成（県＝全キー／市区町村＝選択県の合算。未選択時は全県合算）
  const allPrefList = useMemo(() => Object.keys(areaMap), [areaMap]);
  const cityCandidates = useMemo(
    () => buildCityCandidates(areaMap, selectedPrefs),
    [areaMap, selectedPrefs]
  );

  // 県変更時：候補外の市区町村は自動除外
  useEffect(() => {
    setSelectedDistricts((prev) =>
      sanitizeCitySelection(areaMap, selectedPrefs, prev)
    );
  }, [areaMap, selectedPrefs]);

  /* ===== 並び替え ===== */
  // useCallback版は削除。下の通常定義のみ残す。

  useEffect(() => {
    const fetchAssignments = async () => {
      const token = localStorage.getItem("token");
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_ASSIGN}!A1:ZZ`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const [header, ...rows] = res.data.values || [[]];
      const data = rows.map((row) => {
        const obj = {};
        header.forEach((col, i) => {
          obj[col] = row[i] || "";
        });
        return obj;
      });
      setAssignments(data);
    };
    fetchAssignments();
  }, []);


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

    // 通常はバリデーションするが、お気に入り検索の時はスキップ
    if (!favoritesOnly) {
      if (selectedPrefs.length === 0) {
        setErrorMessage("都道府県を1つ以上選択してください。");
        return;
      }
      if (weekSelections.length === 0) {
        setErrorMessage("曜日を1つ以上選択してください。");
        return;
      }
    }

    setErrorMessage("");
    setHasSearched(true);
    setIsLoading(true);

    const from = parseInt(timeFrom);
    const to = parseInt(timeTo);
    const days = weekSelections; // ← 空なら空車判定は適用しない

    setTimeout(() => {
      const result = partners.filter((p) => {
        // ★お気に入りのみ → ID が含まれていなければ除外
        if (favoritesOnly && !favoriteIds.includes(p["SF_ID__c"])) return false;

        // 離脱などは共通で除外
        if (p["Name"]?.includes("支援終了") || p["Name"]?.includes("離脱"))
          return false;

        // ステータス（稼働/未稼働）フィルタは共通で適用
        if (!statusFilter.includes(p["OperatingStatus__c"])) return false;

        // 都道府県 / 市区町村は、選択がある場合のみ適用（未選択なら素通し）
        if (selectedPrefs.length && !selectedPrefs.includes(p["都道府県"]))
          return false;
        if (
          selectedDistricts.length &&
          !selectedDistricts.includes(p["市区町村"])
        )
          return false;

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
            hours
              .filter((_, i) => i >= from && i <= to)
              .every((h) => (p[`${day}_${h}`] || "").trim() === "0");

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
    }, 0);
  };

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

  // ページ変更時にトップへ（任意のUX改善）
  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <HeaderMenu
        title="空車情報検索（個人事業主）"
        userName={userNameOnly}
        onNavigateHome={handleNavigateHome}
        onLogout={handleLogout}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onNavigateAvailability={() => navigate("/availability")}
        onNavigateWithdrawn={() => navigate("/withdrawn")}
        onNavigateAnalysis={() => navigate("/general-analysis")}
        onNavigateAnken={() => navigate("/subcontractor-analysis")}
      />

      <div className="availability-page">
        {showScrollTop && (
          <button
            className="scroll-to-top"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            検索パネルに戻る
          </button>
        )}

        {/* メニューはHeaderMenuに統一。重複表示防止のため削除 */}

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
                <button onClick={() => setWeekSelections([])}>クリア</button>
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
                <span>歳</span>
                <button
                  type="button"
                  className="clear-btn"
                  onClick={() => {
                    setAgeMin("");
                    setAgeMax("");
                  }}
                  style={{ marginLeft: 8 }}
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
              </button>
              <button
                type="button"
                className={`seg ${
                  tableOrientation === "vertical" ? "active" : ""
                }`}
                onClick={() => setTableOrientation("vertical")}
              >
                縦方向
              </button>
            </div>

            <div
              className="sort-controls"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 8,
              }}
            >
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
              >
                <option value="Name">名前</option>
                <option value="ApprovalDate__c">承認日</option>
                <option value="Now_Age__c">年齢</option>
                <option value="Address__c">住所</option>
                <option value="最終稼働日">最終稼働日</option>
                <option value="favorite">お気に入り</option>
              </select>

              <button
                className={`order-toggle ${sortOrder}`}
                onClick={() =>
                  setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
                }
              >
                {sortOrder === "asc" ? "▲ 昇順" : "▼ 降順"}
              </button>
            </div>

            {hasSearched && !isLoading && (
              <div className="result-count">
                検索結果：{filteredPartners.length} 件<br />（{startIndex}–
                {endIndex} 件を表示）
                <br />
                ページ： {currentPage} / {totalPages}
              </div>
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
            </div>
          </div>
        </div>

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
                  const partnerAssignments = assignments.filter(
                    (a) => a["Partner__r.ID_18__c"] === partnerId
                  );
                  const formatTime = (timeStr) =>
                    timeStr ? timeStr.slice(0, 5) : "";

                  return (
                    <div
                      key={partnerId}
                      className={`partner-card ${isFav ? "favorite-card" : ""}`}
                    >
                      <div className="partner-info-grid">
                        <div>
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
                              <a
                                href={`https://logiquest.lightning.force.com/lightning/r/Contact/${partnerId}/view`}
                                target="_blank"
                                rel="noreferrer"
                                className="name-link"
                              >
                                <strong>
                                  {p["Name"]}（{p["Now_Age__c"]}歳）【
                                  {p["Gender__c"]}性】
                                </strong>
                              </a>
                            </div>

                            {(p["taiou_joukyou__c"] ||
                              p["taioujoukyou_sapto__c"]) && (
                              <div className="info-tooltip">
                                <span className="info-icon">ℹ️</span>
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

                          <LastWorkField
                            status={p["OperatingStatus__c"]}
                            lastWorked={p["最終稼働日"]}
                            lastProject={p["最終案件名"]}
                            formatDate={formatDate}
                          />

                          <hr style={{ border: "1px solid #ccc" }} />

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
                            <a
                              href={`https://logiquest.lightning.force.com/lightning/r/Contact/${partnerId}/related/Partner__r/view`}
                              target="_blank"
                              rel="noreferrer"
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
                            </a>
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
                              {"【" +
                                p["ContractType__c"] +
                                "】 " +
                                p["VehicleShape__c"] || "不明"}
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
                              <a
                                href={`https://www.invoice-kohyo.nta.go.jp/regno-search/detail?selRegNo=${p[
                                  "Invoice_code__c"
                                ].substring(1)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {p["Invoice_code__c"]}
                              </a>
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
                                  <a
                                    href={`https://logiquest.lightning.force.com/lightning/r/Oppotunities__c/${a["Id"]}/view`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {a["Name"] || "案件名不明"}
                                  </a>
                                  {a["Haisyasinsei_komento__c"] && (
                                    <div className="info-tooltip">
                                      ℹ️
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

                        {/* スケジュール表 */}
                        <div className="partner-schedule-container">
                          <div className="schedule-scroll">
                            <table
                              className={`schedule-table ${
                                tableOrientation === "horizontal"
                                  ? "horizontal"
                                  : "vertical"
                              }`}
                            >
                              <thead>
                                <tr>
                                  <th>
                                    {tableOrientation === "horizontal"
                                      ? "曜/時"
                                      : "時/曜"}
                                  </th>
                                  {(tableOrientation === "horizontal"
                                    ? hours
                                    : weekdays
                                  ).map((hdr) => (
                                    <th key={hdr}>{hdr}</th>
                                  ))}
                                </tr>
                              </thead>

                              <tbody>
                                {(tableOrientation === "horizontal"
                                  ? weekdays
                                  : hours
                                ).map((rowHdr) => (
                                  <tr key={rowHdr}>
                                    <td>{rowHdr}</td>

                                    {(tableOrientation === "horizontal"
                                      ? hours
                                      : weekdays
                                    ).map((colHdr) => {
                                      const day =
                                        tableOrientation === "horizontal"
                                          ? rowHdr
                                          : colHdr;
                                      const h =
                                        tableOrientation === "horizontal"
                                          ? colHdr
                                          : rowHdr;
                                      const key = `${day}_${h}`;
                                      const val = p[key] || "";

                                      const inSelectedDay =
                                        weekSelections.includes(day);
                                      const inTimeRange =
                                        parseInt(h) >= parseInt(timeFrom) &&
                                        parseInt(h) <= parseInt(timeTo);

                                      const classNames = [
                                        val === "0"
                                          ? "inactive-cell"
                                          : val === "1"
                                          ? "active-cell"
                                          : "",
                                        inSelectedDay && inTimeRange
                                          ? "matching-cell"
                                          : "",
                                      ]
                                        .join(" ")
                                        .trim();

                                      const displayVal =
                                        val === "0"
                                          ? "空"
                                          : val === "1"
                                          ? "稼"
                                          : "";

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

