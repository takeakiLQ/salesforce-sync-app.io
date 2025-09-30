import React from "react";
import "./HeaderMenu.css";

/**
 * 共通ヘッダーメニューコンポーネント
 * props:
 *   title: ページタイトル
 *   userName: ユーザー名
 *   onNavigateHome: トップに戻るハンドラ
 *   onNavigateAvailability: 空車情報検索ハンドラ
 *   onNavigateWithdrawn: 離脱パートナー検索ハンドラ
 *   onNavigateAnken: 協力会社分析（AnkenPage）ハンドラ
 *   onLogout: ログアウトハンドラ
 *   menuOpen: メニュー表示状態
 *   setMenuOpen: メニュー表示切替関数
 */

import { useLocation } from "react-router-dom";

const MENU_LIST = [
  { label: "トップに戻る", key: "home", path: "/home" },
  { label: "空車情報検索", key: "availability", path: "/availability" },
  { label: "離脱パートナー検索", key: "withdrawn", path: "/withdrawn" },
  { label: "協力会社分析", key: "subcontractor", path: "/subcontractor-analysis" },
  { label: "案件分析", key: "general", path: "/general-analysis" },
];

const HeaderMenu = ({
  title,
  userName,
  onNavigateHome,
  onLogout,
  menuOpen,
  setMenuOpen,
  onNavigateAvailability,
  onNavigateWithdrawn,
  onNavigateAnken
}) => {
  const location = useLocation();
  const currentPath = location.pathname;

  // メニュー外クリックで閉じる
  React.useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      const menuElem = document.querySelector('.menu');
      if (menuElem && !menuElem.contains(e.target) && !e.target.classList.contains('hamburger')) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen, setMenuOpen]);

  // 各ボタンのハンドラ
  const handlers = {
  home: onNavigateHome,
  availability: onNavigateAvailability,
  withdrawn: onNavigateWithdrawn,
  subcontractor: onNavigateAnken,
  general: typeof window !== 'undefined' && window.location ? () => window.location.hash = '#/general-analysis' : undefined,
  };

  return (
    <div className="header">
      <div className="left-section">
        <div className="hamburger" onClick={() => setMenuOpen && setMenuOpen(v => !v)}>☰</div>
        <h1 className="app-title">{title}</h1>
      </div>
      <div className="user-info">{userName}</div>
      {menuOpen && (
        <div className="menu">
          {MENU_LIST.map(({ label, key, path }) => (
            <button
              key={key}
              className={`menu-button${currentPath === path ? ' disabled' : ''}`}
              onClick={currentPath === path ? undefined : handlers[key]}
              disabled={currentPath === path}
              style={currentPath === path ? { color: '#aaa', background: '#f5f5f5', cursor: 'not-allowed' } : {}}
            >
              {label}
            </button>
          ))}
          <button className="menu-button logout" onClick={onLogout}>ログアウト</button>
        </div>
      )}
    </div>
  );
};

export default HeaderMenu;
