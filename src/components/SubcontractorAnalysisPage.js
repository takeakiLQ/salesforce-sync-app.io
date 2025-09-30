// D:\React\salesforce_sync\src\components\SubcontractorAnalysisPage.js
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback
} from "react";
import HeaderMenu from "./HeaderMenu";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./SubcontractorAnalysisPage.css";

const SPREADSHEET_ID = process.env.REACT_APP_SPREADSHEET_ID;

// グラフ用の表示名マッピング
const GROUP_LABELS = {
  北海道主管: "北海道",
  東北主管: "東北",
  北関東北信越主管: "北関東北信越",
  東関東主管: "東関東",
  "都市物流営業部（定期便・東京）": "東京",
  "都市物流営業部（定期便・神奈川）": "神奈川",
  東海主管: "東海",
  京滋奈主管: "京滋奈",
  大阪和歌山主管: "大阪和歌山",
  兵庫主管: "兵庫",
  中国主管: "中国",
  四国主管: "四国",
  九州主管: "九州",
};

// 並び順
const GROUP_ORDER = [
  "北海道主管",
  "東北主管",
  "北関東北信越主管",
  "東関東主管",
  "都市物流営業部（定期便・東京）",
  "都市物流営業部（定期便・神奈川）",
  "東海主管",
  "京滋奈主管",
  "大阪和歌山主管",
  "兵庫主管",
  "中国主管",
  "四国主管",
  "九州主管",
];

const SubcontractorAnalysisPage = () => {
  // ルーティング
  const navigate = useNavigate();

  // 数値変換
  const toNumber = (v) => {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  // 金額フォーマット
  const formatMoney = (v) => {
    const n = toNumber(v);
    return n ? n.toLocaleString() : "";
  };

  // ソート設定
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  // ページング用 ref
  const tableTopRef = React.useRef(null);

  // ユーザー名取得
  const userEmail = localStorage.getItem("userEmail") || "未取得";
  const userNameOnly = userEmail.includes("@") ? userEmail.split("@")[0] : userEmail;
  const [menuOpen, setMenuOpen] = useState(false);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // グラフ選択状態
  const [selectedGroup, setSelectedGroup] = useState(null); // 主管
  const [selectedYear, setSelectedYear] = useState(null); // 経過年数（整数）

  // 詳細リスト（表示用）
  const [showList, setShowList] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState(
    "全主管 × 全経過年数 の協力会社案件"
  );
  const [selectedList, setSelectedList] = useState([]);

  /** 経過年数（初回開始日 vs 今日、端数切り落とし） */
  const calcYears = useCallback((startDateStr) => {
    if (!startDateStr) return "";
    const d = new Date(startDateStr);
    if (isNaN(d)) return "";
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    if (
      now.getMonth() < d.getMonth() ||
      (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())
    ) {
      years--;
    }
    return years < 0 ? 0 : years;
  }, []);

  const filterRows = useCallback(
    (group, year) =>
      allRows.filter((row) => {
        const groupOk = group ? row["Group_FY22__c"] === group : true;
        const yearOk =
          year != null
            ? calcYears(row["初回開始日"]) === Number(year)
            : true;
        return groupOk && yearOk;
      }),
    [allRows, calcYears]
  );

  // グループクリック
  const handleGroupClick = useCallback(
    (group) => {
      const filtered = filterRows(group, selectedYear);
      setSelectedGroup(group);
      setSelectedList(filtered);
      setShowList(true);
      setSelectedTitle(
        `${GROUP_LABELS[group] || group} × ${
          selectedYear != null ? selectedYear + "年" : "全経過年数"
        } の協力会社案件`
      );
    },
    [filterRows, selectedYear]
  );

  // 年数クリック
  const handleYearClick = useCallback(
    (year) => {
      const filtered = filterRows(selectedGroup, year);
      setSelectedYear(year);
      setSelectedList(filtered);
      setShowList(true);
      setSelectedTitle(
        `${
          selectedGroup ? GROUP_LABELS[selectedGroup] || selectedGroup : "全主管"
        } × ${year}年 の協力会社案件`
      );
    },
    [filterRows, selectedGroup]
  );

  // ...existing code...

  /** 率フォーマット（小数1桁%） */
  const formatRate = (num) => {
    if (!Number.isFinite(num)) return "";
    return `${num.toFixed(1)}%`;
  };

  /** 粗利率（%）= 予定粗利 / 予定売上 * 100 */
  const calcGrossMarginPct = useCallback((row) => {
    const sales = toNumber(row["Scheduled_sales_calculation__c"]);
    const profit = toNumber(row["Yotei_Arari_Keisan__c"]);
    if (!Number.isFinite(sales) || sales === 0 || !Number.isFinite(profit))
      return NaN;
    return (profit / sales) * 100;
  }, []);

  /** Salesforce レコードビュー（one.app 形式） */
  const sfLink = (id) =>
    id
      ? `https://logiquest.lightning.force.com/one/one.app#/sObject/${id}/view`
      : null;

  /** データ取得 */
  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          setError("認証トークンがありません。再ログインしてください。");
          setLoading(false);
          return;
        }
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/稼働中案件!A1:ZZ`;
        const res = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const [header, ...rows] = res.data.values || [];
        const data = rows.map((row) => {
          const obj = {};
          header.forEach((col, i) => (obj[col] = row[i] ?? ""));
          return obj;
        });

        // データ上は「業者」でフィルタ（UI表記は「協力会社」に統一）
        const vendors = data.filter(
          (r) => r["Partner_Keiyaku_type_temp__c"] === "業者"
        );

        setAllRows(vendors);
        setSelectedList(vendors);
        setLoading(false);
      } catch (e) {
        console.error(e);
        setError("データ取得中にエラーが発生しました。");
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // filteredListは未使用のため削除

  /** 左：主管別（右の年数選択のみ反映／非選択バーはディム） */
  const groupCounts = useMemo(() => {
    const base =
      selectedYear != null
        ? allRows.filter(
            (r) => calcYears(r["初回開始日"]) === Number(selectedYear)
          )
        : allRows;

    const map = {};
    base.forEach((r) => {
      const g = r["Group_FY22__c"] || "未分類";
      map[g] = (map[g] || 0) + 1;
    });
    return map;
  }, [allRows, selectedYear, calcYears]);

  /** 右：経過年数別（左の主管選択のみ反映） */
  const yearCounts = useMemo(() => {
    const base = selectedGroup
      ? allRows.filter((r) => r["Group_FY22__c"] === selectedGroup)
      : allRows;

    const map = {};
    base.forEach((r) => {
      const y = calcYears(r["初回開始日"]);
      if (y !== "") map[y] = (map[y] || 0) + 1;
    });
    return map;
  }, [allRows, selectedGroup, calcYears]);

      // ...HeaderMenuは本文return内で使用します...
  const handleSort = (key) => {
    // 経過年数は並び替え不要
    if (key === "__YEARS__") return;

    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc")
      direction = "desc";
    setSortConfig({ key, direction });
  };

  const sortedList = useMemo(() => {
    const list = [...selectedList];
    if (!sortConfig.key) return list;

    return list.sort((a, b) => {
      // 粗利率の特別処理
      if (sortConfig.key === "__GrossMarginRate__") {
        const aRate = calcGrossMarginPct(a);
        const bRate = calcGrossMarginPct(b);
        const av = Number.isFinite(aRate) ? aRate : -Infinity;
        const bv = Number.isFinite(bRate) ? bRate : -Infinity;
        return sortConfig.direction === "asc" ? av - bv : bv - av;
      }

      // 金額列
      const moneyKeys = new Set([
        "Scheduled_sales_calculation__c",
        "Yotei_Genka_keisan__c",
        "Yotei_Arari_Keisan__c",
      ]);

      // 日付列
      const dateKeys = new Set(["初回開始日"]);

      let aVal = a[sortConfig.key] ?? "";
      let bVal = b[sortConfig.key] ?? "";

      if (moneyKeys.has(sortConfig.key)) {
        aVal = toNumber(aVal);
        bVal = toNumber(bVal);
      } else if (dateKeys.has(sortConfig.key)) {
        const ad = new Date(aVal);
        const bd = new Date(bVal);
        aVal = isNaN(ad) ? -Infinity : ad.getTime();
        bVal = isNaN(bd) ? -Infinity : bd.getTime();
      } else {
        aVal = String(aVal);
        bVal = String(bVal);
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [selectedList, sortConfig, calcGrossMarginPct]);

  // ====== ページング（sortedList の後に置く）======
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedList.length / PAGE_SIZE)),
    [sortedList.length]
  );

  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedList.slice(start, start + PAGE_SIZE);
  }, [sortedList, currentPage]);

  const startIndex = useMemo(
    () => (sortedList.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0),
    [sortedList.length, currentPage]
  );
  const endIndex = useMemo(
    () => Math.min(currentPage * PAGE_SIZE, sortedList.length),
    [sortedList.length, currentPage]
  );

  // 件数変動でページ補正
  useEffect(() => {
    setCurrentPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const goPage = (p) => {
    setCurrentPage(p);
    setTimeout(() => {
      tableTopRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };

  const renderPagination = () => {
    if (!sortedList.length) return null;

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

    return (
      <div className="pagination">
        <button
          className="page-btn"
          onClick={() => goPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
        >
          前へ
        </button>

        {items.map((it, idx) =>
          it === "…" ? (
            <span key={`e-${idx}`} className="page-ellipsis">
              …
            </span>
          ) : (
            <button
              key={it}
              className={`page-btn ${it === currentPage ? "active" : ""}`}
              onClick={() => goPage(it)}
            >
              {it}
            </button>
          )
        )}

        <button
          className="page-btn"
          onClick={() => goPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
        >
          次へ
        </button>

        <span className="page-info">
          （{startIndex}–{endIndex} / {sortedList.length} 件）
        </span>
      </div>
    );
  };

  /** ヘッダ定義（表示名、キー、幅、右寄せ、sortable） */
  const headers = [
    { label: "主管", key: "Group_FY22__c", w: "col-s", sortable: true },
    { label: "支店", key: "Branch__c", w: "col-s", sortable: true },
    { label: "協力会社名", key: "Partner__r.Name", w: "col-m", sortable: true },
    { label: "案件名", key: "Name", w: "col-l", sortable: true },
    { label: "初回開始日", key: "初回開始日", w: "col-s", sortable: true },
    { label: "年数", key: "__YEARS__", w: "col-xs", sortable: false },
    {
      label: "コマ",
      key: "KADO_YOTEI_NISSUU_AUTO__c",
      w: "col-xs",
      sortable: true,
    },
    {
      label: "売上/月",
      key: "Scheduled_sales_calculation__c",
      w: "col-s",
      right: true,
      sortable: true,
    },
    {
      label: "原価/月",
      key: "Yotei_Genka_keisan__c",
      w: "col-s",
      right: true,
      sortable: true,
    },
    {
      label: "粗利/月",
      key: "Yotei_Arari_Keisan__c",
      w: "col-s",
      right: true,
      sortable: true,
    },
    {
      label: "粗利率",
      key: "__GrossMarginRate__",
      w: "col-xs",
      right: true,
      sortable: true,
    },
    {
      label: "配車申請コメント",
      key: "Haisyasinsei_komento__c",
      w: "col-xl",
      sortable: true,
    },
  ];

  /** グラフ共通 */
  const BarChart = ({ data, title, type }) => {
    // 並び順（region は固定順、year は数値昇順）
    const keys = useMemo(() => {
      if (type === "region") {
        return GROUP_ORDER.filter((k) =>
          Object.prototype.hasOwnProperty.call(data, k)
        );
      }
      return Object.keys(data)
        .map((k) => Number(k))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);
    }, [data, type]);

    const max = keys.length ? Math.max(...keys.map((k) => data[k])) : 0;

    const isDim = (key) => {
      if (type === "region" && selectedGroup && selectedGroup !== key)
        return true;
      if (
        type === "year" &&
        selectedYear != null &&
        Number(selectedYear) !== Number(key)
      )
        return true;
      return false;
    };

    const onClick = (key) =>
      type === "region" ? handleGroupClick(key) : handleYearClick(key);
    const showClear =
      (type === "region" && selectedGroup) ||
      (type === "year" && selectedYear != null);

    return (
      <div className="chart-box">
        <div className="chart-header">
          <h3>{title}</h3>
          {showClear && (
            <button
              className="clear-btn"
              onClick={() => {
                if (type === "region") {
                  setSelectedList(filterRows(null, selectedYear));
                  setSelectedGroup(null);
                  setShowList(true);
                  setSelectedTitle(
                    `全主管 × ${
                      selectedYear != null ? selectedYear + "年" : "全経過年数"
                    } の協力会社案件`
                  );
                } else {
                  setSelectedList(filterRows(selectedGroup, null));
                  setSelectedYear(null);
                  setShowList(true);
                  setSelectedTitle(
                    `${selectedGroup ?? "全主管"} × 全経過年数 の協力会社案件`
                  );
                }
              }}
            >
              クリア
            </button>
          )}
        </div>

        {keys.length === 0 ? (
          <p>表示するデータがありません。</p>
        ) : (
          keys.map((key) => {
            const count = data[key];
            const widthPercent = max > 0 ? (count / max) * 100 : 0;
            const label =
              type === "year" ? `${key}年` : GROUP_LABELS[key] || key;

            return (
              <div
                key={key}
                className="bar-row"
                onClick={() => onClick(key)}
                style={{ cursor: "pointer" }}
              >
                <span className="bar-label">{label}</span>
                <div className="bar-container">
                  <div
                    className={`bar ${type === "year" ? "bar-year" : ""} ${
                      isDim(key) ? "bar-dim" : ""
                    }`}
                    style={{ width: `${widthPercent}%` }}
                  >
                    {count}
                </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  };

  return (
    <div className="anken-page">
      {/* 共通ヘッダー＆メニュー */}
      <HeaderMenu
        title="協力会社分析"
        userName={userNameOnly}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onNavigateHome={() => navigate("/home")}
        onLogout={() => {
          localStorage.removeItem("token");
          localStorage.removeItem("userEmail");
          navigate("/");
        }}
        onNavigateAvailability={() => navigate("/availability")}
        onNavigateWithdrawn={() => navigate("/withdrawn")}
        onNavigateAnalysis={() => navigate("/general-analysis")}
      />

      {/* 本文 */}
      <div className="main-content">
        {loading ? (
          <div className="spinner-wrapper">
            <div className="spinner" aria-label="読み込み中" />
            <div className="loading-text">データ取得中です...</div>
          </div>
        ) : error ? (
          <p style={{ color: "#b00020" }}>{error}</p>
        ) : (
          <>
            {/* グラフ */}
            <div className="charts-row">
              <BarChart
                data={groupCounts}
                title="主管別 協力会社案件数"
                type="region"
              />
              <BarChart
                data={yearCounts}
                title="経過年数別 協力会社案件数"
                type="year"
              />
            </div>

            {/* 詳細リスト */}
            <div className="detail-list">
              <div className="detail-header">
                  <h3>{selectedTitle || "詳細"}</h3>
                  <button
                    className="clear-btn"
                    onClick={() => setShowList((prev) => !prev)}
                  >
                    {showList ? "閉じる" : "表示"}
                  </button>
              </div>
              {showList && (
                <>
                {/* 上部ページネーション + スクロールアンカー */}
                <div ref={tableTopRef} />
                {renderPagination()}

                <table className="anken-table">
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th
                          key={h.key}
                          className={`cell th-click ${h.w || ""} ${
                            h.right ? "right" : ""
                          } ${h.sortable ? "" : "no-sort"}`}
                          onClick={() => h.sortable && handleSort(h.key)}
                          title={h.sortable ? "クリックで並び替え" : ""}
                        >
                          {h.label}
                          {h.sortable &&
                            sortConfig.key === h.key &&
                            (sortConfig.direction === "asc" ? " ▲" : " ▼")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="cell nowrap col-xs">
                          {GROUP_LABELS[row["Group_FY22__c"]] ||
                            row["Group_FY22__c"] ||
                            ""}
                        </td>

                        <td className="cell col-s nowrap">
                          {row["Branch__c"] || ""}
                        </td>

                        {/* 協力会社名（Contactリンク） */}
                        <td className="cell col-m wrap">
                          {row["Partner__r.ID_18__c"] ? (
                            <a
                              href={sfLink(row["Partner__r.ID_18__c"])}
                              target="_blank"
                              rel="noreferrer"
                              className="name-link"
                            >
                              {row["Partner__r.Name"] || "不明"}
                            </a>
                          ) : (
                            row["Partner__r.Name"] || "不明"
                          )}
                        </td>

                        {/* 案件名（レコードIDリンク） */}
                        <td className="cell col-l wrap">
                          {row["Id"] ? (
                            <a
                              href={sfLink(row["Id"])}
                              target="_blank"
                              rel="noreferrer"
                              className="name-link"
                            >
                              {row["Name"] || ""}
                            </a>
                          ) : (
                            row["Name"] || ""
                          )}
                        </td>

                        <td className="cell col-s nowrap">
                          {row["初回開始日"] || ""}
                        </td>
                        <td className="cell col-xs nowrap">
                          {calcYears(row["初回開始日"])}年
                        </td>

                        <td className="cell col-xs nowrap right">
                          {row["KADO_YOTEI_NISSUU_AUTO__c"] || ""}コマ
                        </td>
                        <td className="cell col-s nowrap right">
                          {formatMoney(row["Scheduled_sales_calculation__c"])}
                        </td>
                        <td className="cell col-s nowrap right">
                          {formatMoney(row["Yotei_Genka_keisan__c"])}
                        </td>
                        <td className="cell col-s nowrap right">
                          {formatMoney(row["Yotei_Arari_Keisan__c"])}
                        </td>
                        <td className="cell col-xs nowrap right">
                          {formatRate(calcGrossMarginPct(row))}
                        </td>
                        <td className="cell col-xl wrap">
                          {row["Haisyasinsei_komento__c"] || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* 下部ページネーション */}
                {renderPagination()}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SubcontractorAnalysisPage;

