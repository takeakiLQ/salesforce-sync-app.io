import React, { useEffect, useState } from "react";
import "./ScrollTopButton.css";

/**
 * ページ先頭へ戻る丸ボタン。
 * 表示判定とスクロール監視もここに持たせて、各ページからは置くだけにする。
 *
 * props:
 *   threshold: 何px スクロールしたら表示するか（既定 300）
 */
const ScrollTopButton = ({ threshold = 300 }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => setVisible(window.scrollY > threshold);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="scroll-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      title="ページ先頭へ戻る"
      aria-label="ページ先頭へ戻る"
    >
      <svg
        className="scroll-to-top__icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <polyline
          points="4 16 12 8 20 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="scroll-to-top__label">TOP</span>
    </button>
  );
};

export default React.memo(ScrollTopButton);
