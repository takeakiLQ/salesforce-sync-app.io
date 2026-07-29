import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./PullToRefresh.css";

/**
 * 上から下へのスワイプで更新するジェスチャー。
 *
 * ホーム画面に追加して起動すると（manifest の display: standalone）、
 * iOS・Android ともブラウザ標準のプルトゥリフレッシュが無効になるため、
 * 起動方法に依存しないよう自前で用意している。
 *
 * props:
 *   onRefresh: 実行する処理。省略時はページを再読み込みする。
 *              Promise を返した場合は完了まで表示を維持する。
 *
 * 更新中は全画面のオーバーレイで覆う。
 * データが差し替わる途中で絞り込みを操作されると、
 * 消えた値を選んだままになるなど中途半端な状態が起きるため、
 * その間は操作させない。
 * 併せて、ページ側がそれぞれスピナーを出すと二重に回ってしまうので、
 * 更新中の表示はこのコンポーネントに一本化している。
 */
const THRESHOLD = 70; // ここまで引いたら実行
const MAX_PULL = 110; // 引ける上限
const RESISTANCE = 0.5; // 指の移動量に対する追従率（重み）

const PullToRefresh = ({ onRefresh }) => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // イベントリスナー内から最新値を読むための控え
  const pullRef = useRef(0);
  const startYRef = useRef(null);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const updatePull = useCallback((value) => {
    pullRef.current = value;
    setPull(value);
  }, []);

  const runRefresh = useCallback(async () => {
    refreshingRef.current = true;
    setRefreshing(true);
    updatePull(THRESHOLD);
    try {
      if (onRefreshRef.current) {
        await onRefreshRef.current();
        refreshingRef.current = false;
        setRefreshing(false);
        updatePull(0);
      } else {
        // 既定はページの再読み込み。インジケータを見せてから実行する
        window.setTimeout(() => window.location.reload(), 300);
      }
    } catch (error) {
      console.error("更新に失敗しました", error);
      refreshingRef.current = false;
      setRefreshing(false);
      updatePull(0);
    }
  }, [updatePull]);

  useEffect(() => {
    // 指で操作する端末だけ有効にする（マウス環境では何もしない）
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    if (!window.matchMedia("(pointer: coarse)").matches) return undefined;

    const handleTouchStart = (event) => {
      if (refreshingRef.current || window.scrollY > 0 || event.touches.length !== 1) {
        startYRef.current = null;
        return;
      }
      startYRef.current = event.touches[0].clientY;
    };

    const handleTouchMove = (event) => {
      if (startYRef.current === null) return;

      const delta = event.touches[0].clientY - startYRef.current;

      // 上方向スワイプや、途中でスクロールし始めた場合は通常動作に戻す
      if (delta <= 0 || window.scrollY > 0) {
        if (pullRef.current !== 0) updatePull(0);
        startYRef.current = null;
        return;
      }

      // 引いている間はページのスクロールを止める
      event.preventDefault();
      updatePull(Math.min(MAX_PULL, delta * RESISTANCE));
    };

    const handleTouchEnd = () => {
      if (startYRef.current === null) return;
      startYRef.current = null;

      if (pullRef.current >= THRESHOLD) {
        runRefresh();
      } else {
        updatePull(0);
      }
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    // preventDefault するため passive: false が必須
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [runRefresh, updatePull]);

  // 更新中は全画面で覆い、操作を受け付けない
  if (refreshing) {
    return createPortal(
      <div className="ptr-overlay" role="alert" aria-live="polite">
        <div className="ptr-overlay__spinner" />
        <div className="ptr-overlay__label">更新中...</div>
      </div>,
      document.body
    );
  }

  if (pull <= 0) return null;

  const ready = pull >= THRESHOLD;

  return (
    <div
      className="ptr"
      style={{ transform: `translate(-50%, ${pull}px)` }}
      aria-live="polite"
    >
      <div className="ptr__circle">
        <svg
          className="ptr__icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          style={{ transform: `rotate(${ready ? 180 : 0}deg)` }}
        >
          <polyline
            points="6 10 12 16 18 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className="ptr__label">{ready ? "離して更新" : "引いて更新"}</span>
    </div>
  );
};

export default PullToRefresh;
