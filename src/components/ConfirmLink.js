import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./ConfirmLink.css";

/**
 * 外部サービスへ遷移するリンク。
 * 誤タップでいきなり飛ばないよう、確認ダイアログを挟む。
 *
 * props:
 *   href: 遷移先URL
 *   serviceName: ダイアログに出すサービス名（既定 "Salesforce"）
 *   description: 「何を開くか」の説明（任意）
 *   className / title: <a> にそのまま渡す
 */
const ConfirmLink = ({
  href,
  serviceName = "Salesforce",
  description,
  className,
  title,
  children,
}) => {
  const [confirming, setConfirming] = useState(false);

  const close = useCallback(() => setConfirming(false), []);

  const openLink = useCallback(() => {
    setConfirming(false);
    window.open(href, "_blank", "noopener,noreferrer");
  }, [href]);

  useEffect(() => {
    if (!confirming) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirming, close]);

  const handleClick = (event) => {
    // Ctrl/⌘/Shift+クリックや中クリックは、ブラウザ本来の動作に任せる
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    setConfirming(true);
  };

  return (
    <>
      {/* href は残す。右クリックや別タブで開く操作をそのまま使えるようにするため */}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={className}
        title={title}
        onClick={handleClick}
      >
        {children}
      </a>

      {confirming &&
        createPortal(
          <div
            className="confirm-link__backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`${serviceName}で開きますか？`}
            onClick={close}
          >
            <div
              className="confirm-link"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="confirm-link__title">
                {serviceName}で開きますか？
              </div>
              {description && (
                <div className="confirm-link__target">{description}</div>
              )}
              <div className="confirm-link__note">新しいタブで開きます。</div>
              <div className="confirm-link__actions">
                <button type="button" className="confirm-link__no" onClick={close}>
                  いいえ
                </button>
                <button
                  type="button"
                  className="confirm-link__yes"
                  onClick={openLink}
                  autoFocus
                >
                  はい
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default ConfirmLink;
