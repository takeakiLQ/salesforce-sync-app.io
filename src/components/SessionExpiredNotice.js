import React from "react";
import { useNavigate } from "react-router-dom";
import { clearSession } from "../utils/sheetsApi";
import "./SessionExpiredNotice.css";

/**
 * 認証切れ時に全ページ共通で出す案内。
 * 「該当なし」と誤解されないよう、原因と復帰手段を明示する。
 */
const SessionExpiredNotice = ({ message, onRetry }) => {
  const navigate = useNavigate();

  const handleReauth = () => {
    clearSession();
    navigate("/");
  };

  return (
    <div className="session-expired" role="alert">
      <div className="session-expired__body">
        <div className="session-expired__title">⚠️ データを取得できませんでした</div>
        <div className="session-expired__text">
          {message ||
            "Googleの認証が切れています。再ログインすると検索できるようになります。"}
        </div>
      </div>
      <div className="session-expired__actions">
        {onRetry && (
          <button type="button" className="session-expired__retry" onClick={onRetry}>
            再試行
          </button>
        )}
        <button type="button" className="session-expired__button" onClick={handleReauth}>
          再ログインする
        </button>
      </div>
    </div>
  );
};

export default SessionExpiredNotice;
