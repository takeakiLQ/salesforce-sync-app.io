import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearSession, clearSheetCache } from "../utils/sheetsApi";
import "./HeaderMenu.css";

/**
 * 共通ヘッダーメニュー。
 * 開閉状態・遷移・ログアウトはすべてこのコンポーネントが持つ。
 * （開閉stateをページ側に置くと、メニューを開くだけで検索結果全体が再描画されてしまう）
 *
 * props:
 *   title: ページタイトル
 *   userName: 表示名（省略時は localStorage のメールアドレスから生成）
 */

const MENU_LIST = [
  { label: "トップに戻る", path: "/home" },
  { label: "空車情報検索", path: "/availability" },
  { label: "離脱パートナー検索", path: "/withdrawn" },
  { label: "協力会社分析", path: "/subcontractor-analysis" },
  { label: "案件分析", path: "/general-analysis" },
];

const resolveUserName = () => {
  const email =
    (typeof window !== "undefined" && localStorage.getItem("userEmail")) || "未取得";
  return email.includes("@") ? email.split("@")[0] : email;
};

const HeaderMenu = ({ title, userName }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const displayName = userName || resolveUserName();
  const close = useCallback(() => setOpen(false), []);

  // メニュー外クリック / Escape で閉じる
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        close();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  const handleNavigate = (path) => {
    close();
    navigate(path);
  };

  const handleLogout = () => {
    close();
    // 認証情報とシートキャッシュのみ破棄（お気に入り等の設定は残す）
    clearSession();
    clearSheetCache();
    navigate("/");
  };

  return (
    <div className="header" ref={containerRef}>
      <div className="left-section">
        <button
          type="button"
          className="hamburger"
          aria-label="メニュー"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          ☰
        </button>
        <h1 className="app-title">{title}</h1>
      </div>
      <div className="user-info">{displayName}</div>

      {open && (
        <div className="menu">
          {MENU_LIST.map(({ label, path }) => {
            const isCurrent = pathname === path;
            return (
              <button
                key={path}
                type="button"
                className={`menu-button${isCurrent ? " disabled" : ""}`}
                onClick={() => handleNavigate(path)}
                disabled={isCurrent}
              >
                {label}
              </button>
            );
          })}
          <button type="button" className="menu-button logout" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
};

// ページ側の再描画に引きずられないようにする
export default React.memo(HeaderMenu);
