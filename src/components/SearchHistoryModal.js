import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  fetchSearchHistories,
  updateSearchHistory,
} from "../utils/searchHistoryApi";
import "./SearchHistoryModal.css";

const AUTO_SEARCH_KEY = "searchHistory_autoSearch";

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatElapsed = (ms) => {
  if (ms == null || ms === "") return "";
  const num = Number(ms);
  if (Number.isNaN(num) || num < 0) return "";
  if (num < 1000) return `${num}ms`;
  return `${(num / 1000).toFixed(2)}s`;
};

const clampText = (value, maxLength = 120) => {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const groupByThree = (items = [], maxLines = Infinity) => {
  if (!Array.isArray(items) || !items.length) return [];
  const lines = [];
  const maxItems = Math.max(0, maxLines) * 3;
  const limited = items.slice(0, maxItems || items.length);
  for (let index = 0; index < limited.length && lines.length < maxLines; index += 3) {
    const chunk = limited.slice(index, index + 3);
    if (chunk.length) {
      lines.push(chunk.join(" / "));
    }
  }
  if (Number.isFinite(maxLines) && maxLines > 0 && items.length > maxLines * 3 && lines.length) {
    const extra = items.length - maxLines * 3;
    lines[lines.length - 1] = `${lines[lines.length - 1]} / 他${extra}件`;
  }
  return lines;
};

const buildDisplayLines = (row) => {
  const params = row?.searchParams || {};
  const lines = [];

  const pageKey = String(row?.pageKey || params.pageKey || "").toLowerCase();
  const isWithdrawn = pageKey === "withdrawn";

  const prefectures = Array.isArray(params.selectedPrefs) ? params.selectedPrefs : [];
  const prefectureLines = groupByThree(prefectures, isWithdrawn ? Infinity : 1);
  prefectureLines.forEach((line) => {
    if (line) {
      lines.push(clampText(line, 120));
    }
  });

  const districtsSource = Array.isArray(params.selectedDistricts)
    ? params.selectedDistricts
    : Array.isArray(params.selectedCities)
    ? params.selectedCities
    : [];

  const districtLines = groupByThree(districtsSource, isWithdrawn ? Infinity : 3);
  districtLines.forEach((line) => {
    if (line) {
      lines.push(clampText(line, 120));
    }
  });

  if (isWithdrawn) {
    const buildCountLine = (label, list) => {
      const count = Array.isArray(list) ? list.length : 0;
      return `${label}: ${count ? `${count}件選択` : "選択なし"}`;
    };

    [
      buildCountLine("離脱大区分", params.selectedDai),
      buildCountLine("離脱中区分", params.selectedChu),
      buildCountLine("離脱小区分", params.selectedSho),
    ].forEach((entry) => {
      lines.push(clampText(entry, 120));
    });

    const ageMinRaw = params.ageMin ?? "";
    const ageMaxRaw = params.ageMax ?? "";
    const hasAge = String(ageMinRaw).trim() !== "" || String(ageMaxRaw).trim() !== "";
    const ageLine = hasAge
      ? `年齢: ${(String(ageMinRaw).trim() || "__")}〜${(String(ageMaxRaw).trim() || "__")}`
      : "年齢: 指定なし";
    lines.push(clampText(ageLine, 120));

    if (params.favoritesOnly) {
      lines.push(clampText("お気に入りのみ", 120));
    }

    const keywordText = (params.keyword ?? "").toString().trim();
    if (keywordText.length > 0) {
      const summaryPattern = /(都道府県|市区町村|離脱[大中小]区分|年齢|お気に入り):/;
      if (!summaryPattern.test(keywordText)) {
        lines.push(clampText(`キーワード: ${keywordText}`, 120));
      }
    }

    const detailText = (params.quitDetailKeyword ?? "").toString().trim();
    if (detailText.length > 0) {
      lines.push(clampText(`詳細: ${detailText}`, 120));
    }

    if (!lines.length) {
      lines.push("(条件なし)");
    }

    return lines;
  }

  const others = [];
  if (Array.isArray(params.weekSelections) && params.weekSelections.length) {
    others.push(`曜日: ${params.weekSelections.join(" / ")}`);
  }
  if (params.timeFrom || params.timeTo) {
    const from = params.timeFrom ?? "--";
    const to = params.timeTo ?? "--";
    others.push(`時間: ${from}〜${to}`);
  }
  if (Array.isArray(params.statusFilter) && params.statusFilter.length) {
    others.push(`状態: ${params.statusFilter.join(" / ")}`);
  }
  if (params.favoritesOnly) {
    others.push("お気に入りのみ");
  }
  if (params.strictMatch) {
    others.push("完全一致");
  }

  others.forEach((entry) => {
    if (entry) {
      lines.push(clampText(entry, 120));
    }
  });

  if (!lines.length) {
    const fallback = row.keyword || params.keyword || "(条件なし)";
    lines.push(clampText(fallback, 120));
  }

  return lines;
};


const SearchHistoryModal = ({
  isOpen,
  onClose,
  userId,
  pageKey,
  onApply,
  onSearch,
}) => {
  const [histories, setHistories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoSearch, setAutoSearch] = useState(() => {
    const stored = localStorage.getItem(AUTO_SEARCH_KEY);
    return stored == null ? true : stored === "true";
  });

  const loadHistories = useCallback(async () => {
    if (!isOpen || !userId) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchSearchHistories({ userId, pageKey });
      setHistories(data);
    } catch (err) {
      console.error("検索履歴の取得に失敗しました", err);
      setError("検索履歴の取得に失敗しました");
      setHistories([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen, userId, pageKey]);

  useEffect(() => {
    if (!isOpen) return;
    loadHistories();
  }, [isOpen, loadHistories]);

  const handleToggleAutoSearch = useCallback((event) => {
    const next = event.target.checked;
    setAutoSearch(next);
    localStorage.setItem(AUTO_SEARCH_KEY, next ? "true" : "false");
  }, []);

  const applyRow = useCallback(
    (row) => {
      if (!row) return;
      const params = row.searchParams || {};
      if (autoSearch) {
        if (onSearch) onSearch(params, row);
      } else if (onApply) {
        onApply(params, row);
      }
      if (onClose) onClose();
    },
    [autoSearch, onApply, onSearch, onClose]
  );

  const toggleFavorite = useCallback(
    async (row) => {
      if (!row) return;
      try {
        const next = !row.favoriteFlag;
        setHistories((prev) =>
          prev.map((item) =>
            item.id === row.id ? { ...item, favoriteFlag: next } : item
          )
        );
        await updateSearchHistory({ id: row.id, favoriteFlag: next });
        await loadHistories();
      } catch (err) {
        console.error("お気に入り更新に失敗しました", err);
        setError("お気に入りの更新に失敗しました");
        await loadHistories();
      }
    },
    [loadHistories]
  );

  const deleteRow = useCallback(
    async (row) => {
      if (!row) return;
      try {
        setHistories((prev) => prev.filter((item) => item.id !== row.id));
        await updateSearchHistory({ id: row.id, isDeleted: true });
        await loadHistories();
      } catch (err) {
        console.error("検索履歴の削除に失敗しました", err);
        setError("検索履歴の削除に失敗しました");
        await loadHistories();
      }
    },
    [loadHistories]
  );

  const emptyMessage = useMemo(() => {
    if (loading) return "読み込み中...";
    if (error) return error;
    return "検索履歴はまだありません";
  }, [loading, error]);

  if (!isOpen) return null;

  return (
    <div className="search-history-modal__overlay" role="dialog" aria-modal="true">
      <div className="search-history-modal__container">
        <header className="search-history-modal__header">
          <h2>検索履歴</h2>
          <button type="button" className="search-history-modal__close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="search-history-modal__controls">
          <label className="search-history-modal__toggle">
            <input
              type="checkbox"
              checked={autoSearch}
              onChange={handleToggleAutoSearch}
            />
            履歴選択時に即時検索する
          </label>
          <button
            type="button"
            className="search-history-modal__refresh"
            onClick={loadHistories}
            disabled={loading}
          >
            再読込
          </button>
        </div>

        <div className="search-history-modal__body">
          {histories.length === 0 ? (
            <p className="search-history-modal__empty">{emptyMessage}</p>
          ) : (
            <ul className="search-history-modal__list">
              {histories.map((row) => {
                const keywordLines = buildDisplayLines(row);
                return (
                  <li key={row.id} className="search-history-modal__item">
                    <button
                      type="button"
                      className="search-history-modal__main"
                      onClick={() => applyRow(row)}
                      disabled={loading}
                    >
                      <div className="search-history-modal__summary">
                        <div className="search-history-modal__keyword">
                          {keywordLines.map((line, idx) => (
                            <span key={`kw-${row.id}-${idx}`}>{line}</span>
                          ))}
                        </div>
                        <span className="search-history-modal__datetime">
                          {formatDateTime(row.executedAt)}
                        </span>
                      </div>
                      <div className="search-history-modal__meta">
                        {row.resultCount != null && row.resultCount !== "" && (
                          <span>件数: {row.resultCount}</span>
                        )}
                        {row.elapsedMs != null && row.elapsedMs !== "" && (
                          <span>処理時間: {formatElapsed(row.elapsedMs)}</span>
                        )}
                        {row.pageUrl && (
                          <span className="search-history-modal__page">{row.pageUrl}</span>
                        )}
                      </div>
                    </button>
                    <div className="search-history-modal__actions">
                      <button
                        type="button"
                        className={`search-history-modal__favorite ${
                          row.favoriteFlag ? "is-active" : ""
                        }`}
                        onClick={() => toggleFavorite(row)}
                        title={row.favoriteFlag ? "お気に入りを解除" : "お気に入りに追加"}
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        className="search-history-modal__delete"
                        onClick={() => deleteRow(row)}
                        title="履歴を削除"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

SearchHistoryModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  userId: PropTypes.string,
  pageKey: PropTypes.string,
  onApply: PropTypes.func,
  onSearch: PropTypes.func,
};

SearchHistoryModal.defaultProps = {
  isOpen: false,
  onClose: undefined,
  userId: undefined,
  pageKey: "",
  onApply: undefined,
  onSearch: undefined,
};

export default SearchHistoryModal;
