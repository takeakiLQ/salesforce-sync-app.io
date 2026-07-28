import React from "react";
import "./Pagination.css";

/**
 * 検索結果の共通ページネーション。
 * ページ数が多いときは 1 … 前後 … 最終 の形に省略する。
 *
 * props:
 *   currentPage: 現在のページ（1始まり）
 *   totalPages: 総ページ数
 *   onChange: ページ変更ハンドラ (page) => void
 */
const MAX_BUTTONS = 7;

const buildItems = (currentPage, totalPages) => {
  const items = [];
  if (totalPages <= MAX_BUTTONS) {
    for (let i = 1; i <= totalPages; i++) items.push(i);
    return items;
  }

  const left = Math.max(2, currentPage - 1);
  const right = Math.min(totalPages - 1, currentPage + 1);
  items.push(1);
  if (left > 2) items.push("…");
  for (let i = left; i <= right; i++) items.push(i);
  if (right < totalPages - 1) items.push("…");
  items.push(totalPages);
  return items;
};

const Pagination = ({ currentPage, totalPages, onChange }) => {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      <button
        type="button"
        className="page-btn"
        onClick={() => onChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
      >
        前へ
      </button>

      {buildItems(currentPage, totalPages).map((item, idx) =>
        item === "…" ? (
          <span key={`ellipsis-${idx}`} className="page-ellipsis">
            …
          </span>
        ) : (
          <button
            type="button"
            key={item}
            className={`page-btn ${item === currentPage ? "active" : ""}`}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        className="page-btn"
        onClick={() => onChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages}
      >
        次へ
      </button>
    </div>
  );
};

export default React.memo(Pagination);
