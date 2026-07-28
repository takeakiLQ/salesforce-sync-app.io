import { useEffect, useRef } from "react";

/**
 * 値が落ち着いてから localStorage に保存する。
 *
 * 検索条件のキャッシュは年齢やキーワードを1文字打つたびに
 * JSON.stringify + 同期書き込みが走っていたため、間引く。
 *
 * @param {string} key localStorage のキー
 * @param {any} value 保存する値（JSONにできるもの）
 * @param {number} delay 何ミリ秒待ってから書くか
 */
export default function useDebouncedSave(key, value, delay = 300) {
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(valueRef.current));
      } catch (error) {
        console.error("検索条件の保存に失敗しました", key, error);
      }
    }, delay);

    return () => window.clearTimeout(timer);
    // value は毎回新しいオブジェクトになるため、中身で比較する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay, JSON.stringify(value)]);
}
