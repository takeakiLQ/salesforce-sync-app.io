// 新しいデプロイに気づいて読み込み直す仕組み。
//
// ホーム画面に追加して standalone で起動すると、index.html がキャッシュされたまま
// 残り続け、デプロイしても古い画面が出続けることがある。
// JS と CSS はファイル名にハッシュが付くので、古くなりうるのは index.html だけ。
// （このアプリは Service Worker を登録していないため、原因は純粋に HTTP キャッシュ）
//
// そこで index.html だけをキャッシュ無視で取り直し、そこが参照している
// main.<hash>.js が今動いているものと違えば、新しいデプロイがあると判断して
// 読み込み直す。

const SCRIPT_PATTERN = /static\/js\/main\.[A-Za-z0-9_-]+\.js/;

// 再読み込みしても古いままだった場合に無限ループしないための記録
const RETRY_KEY = "appUpdateReloadedFor";

/** いま動いているバンドルのファイル名。開発サーバーでは付かないので null */
const runningScript = () => {
  const sources = Array.from(document.querySelectorAll("script[src]")).map((tag) =>
    tag.getAttribute("src")
  );
  const hit = sources.find((src) => src && SCRIPT_PATTERN.test(src));
  return hit ? hit.match(SCRIPT_PATTERN)[0] : null;
};

/**
 * 新しいデプロイがあれば読み込み直す。
 * @returns {Promise<boolean>} 再読み込みを開始したか
 */
export async function checkForAppUpdate() {
  const running = runningScript();
  // 開発サーバー（bundle.js）はハッシュが無いので何もしない
  if (!running) return false;

  try {
    // no-store に加えてクエリも変える。webview が no-store を無視することがあるため
    const response = await fetch(
      `${process.env.PUBLIC_URL}/index.html?_=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!response.ok) return false;

    const latest = (await response.text()).match(SCRIPT_PATTERN)?.[0];
    if (!latest || latest === running) return false;

    if (sessionStorage.getItem(RETRY_KEY) === latest) return false;
    sessionStorage.setItem(RETRY_KEY, latest);

    window.location.reload();
    return true;
  } catch (error) {
    // 圏外などで失敗しても、そのまま今の版を使えばよい
    console.warn("更新の確認に失敗しました", error);
    return false;
  }
}

/**
 * 起動時と、バックグラウンドから復帰したときに確認する。
 *
 * standalone のアプリは終了せず休止するだけのことが多く、
 * 起動時の1回だけでは復帰時に古いままになる。
 *
 * @returns {() => void} 後始末
 */
export function watchForAppUpdate() {
  checkForAppUpdate();

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") checkForAppUpdate();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}
