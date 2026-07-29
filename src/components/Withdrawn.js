import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./SearchPage.css";
import HeaderMenu from "./HeaderMenu";
import LocationSelectorModal from "./LocationSelectorModal";
import SearchHistoryModal from "./SearchHistoryModal";
import SessionExpiredNotice from "./SessionExpiredNotice";
import Pagination from "./Pagination";
import ScrollTopButton from "./ScrollTopButton";
import PullToRefresh from "./PullToRefresh";
import ConfirmLink from "./ConfirmLink";
import { fetchPrefectureCityMap, buildCityCandidates, sanitizeCitySelection } from "../utils/locationOptions";
import { addSearchHistory } from "../utils/searchHistoryApi";
import { fetchSheetRows, isAuthError } from "../utils/sheetsApi";
import useMediaQuery from "../utils/useMediaQuery";
import useDebouncedSave from "../utils/useDebouncedSave";

// 2万行まで取得（列オープン）
const RANGE_EXITED = "離脱パートナー!A1:20000";
const FILTER_CACHE_KEY = "withdrawnFilters_v1";
const SEARCH_HISTORY_PAGE_KEY = "withdrawn";

/* ====== お気に入り ====== */
const FAV_STORAGE_KEY = "withdrawn_favorites_v1";
const getPartnerKey = (p) =>
  p["SF_ID__c"] || `${p["Name"] || "NONAME"}-${p["ApprovalDate__c"] || ""}`;


/* ====== 固定の選択肢（離脱判断） ====== */
const Q_DAI_OPTIONS = [
  "【パートナー判断】稼働条件合わず",
  "【パートナー判断】事故・免停免取",
  "【パートナー判断】開業支援期間終了",
  "【パートナー判断】健康上の問題",
  "【パートナー判断】ロジクエストへの不満",
  "【パートナー判断】その他",
  "【当社判断】使いたくない",
  "【当社判断】その他",
];

// 中区分：元の“フル文言”（検索に使う値）
const Q_CHU_OPTIONS_FULL = [
  "【リサイクル可】働き方（具体的な希望条件を詳細欄に）",
  "【リサイクル可】業務内容（具体的な希望条件を詳細欄に）",
  "【リサイクル可】車両積載・色など（具体的な内容を詳細欄に）",
  "【リサイクル可】収入面（具体的な希望条件を詳細欄に）",
  "【リサイクル可】家庭事情（どんな事情なのかを聞ければ詳細欄に）",
  "【リサイクル可】案件がない",
  "【リサイクル可】家業継承（業種・職種を詳細欄に）",
  "【リサイクル可】音信不通（状況を詳細欄に）",
  "【リサイクル可】復帰可能性あり（具体的な内容を詳細欄に）",
  "【リサイクル不可】復帰可能性なし（具体的な内容を詳細欄に）",
  "【リサイクル可】免停・免取・稼働意志あり（状況を詳細欄に）",
  "【リサイクル不可】免停・免取・稼働意志なし（状況を詳細欄に）",
  "【リサイクル可】荷主NG（NG理由を詳細欄に）",
  "【リサイクル不可】荷主NG（NG理由を詳細欄に）",
  "【リサイクル不可】本人死去（理由・病名を詳細欄に）",
  "【リサイクル不可】本人の自信喪失（具体的な内容を詳細欄に）",
  "【リサイクル不可】本人からのクレーム多（具体的な内容を詳細欄に）",
  "【リサイクル不可】人物的に難あり（具体的な内容を詳細欄に）",
  "【リサイクル不可】事故により廃車となった",
  "【リサイクル不可】荷主からのクレーム多発（具体的な内容を詳細欄に）",
  "【リサイクル不可】高齢のため引退",
  "【リサイクル可】その他（内容を詳細欄に）",
  "【リサイクル不可】その他（内容を詳細欄に）",
  "【リサイクル可】その他（具体的な内容を詳細欄に）",
  "【リサイクル不可】その他（具体的な内容を詳細欄に）",
];

// 短縮ラベル化（"（" 以降を落とす）
const shortLabel = (s) => (s?.includes("（") ? s.split("（")[0] : s) || "";

// グループ化：{ label: "【リサイクル可】その他", values: ["…内容…", "…具体的…"] } の配列
const Q_CHU_GROUPS = (() => {
  const map = new Map(); // label -> Set(values)
  for (const full of Q_CHU_OPTIONS_FULL) {
    const label = shortLabel(full);
    if (!map.has(label)) map.set(label, new Set());
    map.get(label).add(full);
  }
  return Array.from(map.entries()).map(([label, set]) => ({
    label,
    values: Array.from(set),
  }));
})();

const Q_SHO_OPTIONS = ["離脱後は自己・他社稼働", "離脱後は転職", "離脱後は廃業", "離脱後は不明"];

/* ====== ヘルパ ====== */
const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}
// 離脱日はこの2つだけ
const EXIT_DATE_KEYS = ["WithdrawalDate__c", "DeclineChangeDate__c"];

const formatDate = (dateStr) => {
  if (!dateStr) return null;
  if (!isNaN(dateStr) && String(dateStr).trim() !== "") {
    // Excelシリアル対応
    const base = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(base.getTime() + Number(dateStr) * 86400000);
    if (!isNaN(d)) return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  }
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

/* ====== 1行分の表示用データ（表・カードで共用） ====== */
const buildRowView = (p) => {
  const prefVal = pick(p, ["MailingState", "都道府県"]);
  const cityVal = pick(p, ["MailingCity", "市区町村"]);
  const streetVal = p["MailingStreet"] || "";

  return {
    partnerId: p["SF_ID__c"],
    name: p["Name"] || "氏名不明",
    kana: p["Name__c"] || "",
    age: p["Now_Age__c"] || "",
    gender: p["Gender__c"] || "",
    addrFull:
      prefVal || cityVal || streetVal
        ? `${prefVal || ""}${cityVal || ""}${streetVal || ""}`
        : p["Address__c"] || "",
    phone: p["MobilePhone"],
    approval: p["ApprovalDate__c"],
    exitDate: pick(p, EXIT_DATE_KEYS),
    lastWorkDate: p["最終稼働日"], // 正規化済み
    quitDai: p["Quit_Dai__c"] || "",
    quitChu: p["Quit_chu__c"] || "",
    quitSho: p["Quit_sho__c"] || "",
    quitDetail: p["Quit_detail__c"] || "",
  };
};

const sfContactUrl = (partnerId) =>
  `https://logiquest.lightning.force.com/lightning/r/Contact/${partnerId}/view`;

/* ====== スマホ用カード ======
   11列の表は狭い画面では横スクロールしても読めないため、
   768px以下では1件1カードに描き分ける。 */
const WithdrawnCard = ({ view, favorite, onToggleFavorite }) => {
  const {
    partnerId,
    name,
    kana,
    age,
    gender,
    addrFull,
    phone,
    approval,
    exitDate,
    lastWorkDate,
    quitDai,
    quitChu,
    quitSho,
    quitDetail,
  } = view;

  // 「リサイクル可／不可」は再獲得の可否に直結するので目立たせる
  const recyclable = quitChu.startsWith("【リサイクル可】")
    ? "ok"
    : quitChu.startsWith("【リサイクル不可】")
    ? "ng"
    : null;

  return (
    <div className={`wd-card${recyclable ? ` wd-card--${recyclable}` : ""}`}>
      <div className="wd-card__head">
        <button
          type="button"
          className={`star-btn ${favorite ? "on" : ""}`}
          onClick={onToggleFavorite}
          title={favorite ? "お気に入り解除" : "お気に入りに追加"}
          aria-label="お気に入り"
        >
          {favorite ? "★" : "☆"}
        </button>

        <div className="wd-card__name">
          {kana && <div className="kana-small">{kana}</div>}
          <div>
            {partnerId ? (
              <ConfirmLink
                href={sfContactUrl(partnerId)}
                description={`${name} さんのパートナー情報`}
                className="name-link"
              >
                {name}
              </ConfirmLink>
            ) : (
              name
            )}
            <span className="wd-card__meta">
              {age && `${age}歳`}
              {age && gender && "・"}
              {gender && `${gender}性`}
            </span>
          </div>
        </div>

        {recyclable && (
          <span className={`wd-badge wd-badge--${recyclable}`}>
            {recyclable === "ok" ? "リサイクル可" : "リサイクル不可"}
          </span>
        )}
      </div>

      <div className="wd-card__row">
        <span className="wd-card__label">携帯</span>
        <span className="wd-card__value">
          {phone ? (
            <a href={`tel:${phone}`} className="wd-card__phone">
              {phone}
            </a>
          ) : (
            <span className="wd-card__missing">なし</span>
          )}
        </span>
      </div>

      <div className="wd-card__row">
        <span className="wd-card__label">住所</span>
        <span className="wd-card__value">{addrFull || "-"}</span>
      </div>

      <div className="wd-card__dates">
        <div>
          <span className="wd-card__label">離脱日</span>
          <span className={exitDate ? "" : "wd-card__missing"}>
            {exitDate ? formatDate(exitDate) : "不明"}
          </span>
        </div>
        <div>
          <span className="wd-card__label">最終稼働</span>
          <span className={lastWorkDate ? "" : "wd-card__missing"}>
            {lastWorkDate ? formatDate(lastWorkDate) : "-"}
          </span>
        </div>
        <div>
          <span className="wd-card__label">承認日</span>
          <span>{approval ? formatDate(approval) : "不明"}</span>
        </div>
      </div>

      <div className="wd-card__reason">
        <div className="wd-card__label">離脱判断</div>
        <div className="wd-card__reason-line">{quitDai || "-"}</div>
        <div className="wd-card__reason-line">{shortLabel(quitChu) || "-"}</div>
        <div className="wd-card__reason-line">{quitSho || "-"}</div>
        {quitDetail && <div className="wd-card__detail">{quitDetail}</div>}
      </div>
    </div>
  );
};

/* ====== 共通モーダル ====== */
function Modal({ open, title, children, onClose, onApply }) {
  if (!open) return null;
  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <button className="clear-btn" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div style={styles.modalContent}>{children}</div>
        <div style={styles.modalFooter}>
          <button className="clear-btn" onClick={onClose}>キャンセル</button>
          <button className="search" onClick={onApply}>適用</button>
        </div>
      </div>
    </div>
  );
}

export default function Withdrawn() {
  const savedFilters = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(FILTER_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.error("Failed to read withdrawn filters from cache", error);
      return null;
    }
  }, []);

  const pickArray = (key, fallback) => {
    if (savedFilters && Array.isArray(savedFilters[key])) {
      return [...savedFilters[key]];
    }
    return fallback;
  };

  const pickString = (key, fallback) => {
    if (savedFilters && typeof savedFilters[key] === "string") {
      return savedFilters[key];
    }
    return fallback;
  };

  const pickBoolean = (key, fallback) => {
    if (savedFilters && typeof savedFilters[key] === "boolean") {
      return savedFilters[key];
    }
    return fallback;
  };
  // ...state宣言群...
  // ...既存の state宣言群...

  // areaMap宣言を最初に持ってくる
  const [areaMap, setAreaMap] = useState({}); // {pref: [city,...]}
  // 住所フィルタ（モーダルで複数選択）
  const [selectedPrefs, setSelectedPrefs] = useState(() => pickArray("selectedPrefs", [])); // 都道府県：複数
  const [selectedCities, setSelectedCities] = useState(() => pickArray("selectedCities", [])); // 市区町村：複数

  const [locationModalType, setLocationModalType] = useState(null); // 都道府県/市区町村モーダル

  // 都道府県リスト
  const allPrefList = useMemo(() => Object.keys(areaMap), [areaMap]);

  // 市区町村候補
  const cityCandidates = useMemo(
    () => buildCityCandidates(areaMap, selectedPrefs),
    [areaMap, selectedPrefs]
  );

  // 離脱パートナー＋都道府県マスタ取得
  // （sheetsApi 側でキャッシュされるため、ページを行き来しても再ダウンロードされない）
  const loadData = useCallback(async ({ force = false } = {}) => {
    exitedReadyRef.current = false;
    setNeedReauth(false);
    setErrorMessage("");

    const [exitedResult, areaResult] = await Promise.allSettled([
      // ヘッダに空白が混じるシートのため正規化キーも併記する（例: "最終 稼働日"→"最終稼働日"）
      fetchSheetRows(RANGE_EXITED, { force, normalizeKeys: true }),
      fetchPrefectureCityMap({ force }),
    ]);

    setExitedPartners(exitedResult.status === "fulfilled" ? exitedResult.value : []);
    if (areaResult.status === "fulfilled") {
      setAreaMap(areaResult.value);
    }

    exitedReadyRef.current = true;

    const failures = [exitedResult, areaResult]
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason);
    if (failures.some(isAuthError)) {
      setNeedReauth(true);
    } else if (failures.length) {
      console.error("離脱パートナー情報の取得に失敗:", failures);
      setErrorMessage("データの取得に失敗しました。時間をおいて再試行してください。");
    }
  }, []);


  // 全件取得のため、マウント時の1回だけに限定する
  // （検索条件の変更で再取得してはいけない：数千〜2万行のダウンロードが走る）
  useEffect(() => {
    loadData();
  }, [loadData]);

  // お気に入り
  const [showFavOnly, setShowFavOnly] = useState(() => pickBoolean("showFavOnly", false));
  const [favorites, setFavorites] = useState(() => {
    // localStorageから初期値取得
    try {
      const raw = localStorage.getItem(FAV_STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const isFav = (p) => favorites.has(getPartnerKey(p));

  // お気に入りトグル
  const toggleFavorite = (p) => {
    const key = getPartnerKey(p);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      // localStorageにも保存
      localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };


  // （重複宣言を削除）
  const [exitedPartners, setExitedPartners] = useState([]);
  const exitedReadyRef = useRef(false);
  // 前回の条件を復元する場合は、最初から「検索待ち」状態にしておく
  const pendingExitedSearchRef = useRef(
    Boolean(savedFilters && savedFilters.hasSearched)
  );

  // 検索結果（初期表示は空）
  const [filtered, setFiltered] = useState([]);
  const [rawFiltered, setRawFiltered] = useState([]);
  // 前回検索していたなら、データ到着後に同じ条件で自動的に検索し直す
  const restoreSearch = Boolean(savedFilters && savedFilters.hasSearched);
  const [hasSearched, setHasSearched] = useState(restoreSearch);
  const [isLoading, setIsLoading] = useState(restoreSearch);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  // 検索パネルの開閉（検索して結果が出たら畳む）
  const [panelOpen, setPanelOpen] = useState(true);
  // 狭い画面では結果を表ではなくカードで出す
  const isNarrow = useMediaQuery("(max-width: 768px)");

  // 年齢・キーワード
  // 都道府県リスト
  const [ageMin, setAgeMin] = useState(() => pickString("ageMin", ""));
  const [ageMax, setAgeMax] = useState(() => pickString("ageMax", ""));
  const [keyword, setKeyword] = useState(() => pickString("keyword", ""));
  const [quitDetailKeyword, setQuitDetailKeyword] = useState(() => pickString("quitDetailKeyword", ""));

  // 離脱判断（複数選択）
  const [selectedDai, setSelectedDai] = useState(() => pickArray("selectedDai", []));
  const [selectedChu, setSelectedChu] = useState(() => pickArray("selectedChu", [])); // ★中区分は“フル文言”を保持
  const [selectedSho, setSelectedSho] = useState(() => pickArray("selectedSho", []));

  // 並び替え
  const [sortKey, setSortKey] = useState(() => pickString("sortKey", "ExitDate__c"));
  const [sortOrder, setSortOrder] = useState(() => pickString("sortOrder", "desc"));

  // 検索条件のキャッシュ。キーワードを1文字打つたびに同期書き込みが
  // 走らないよう、入力が落ち着いてから保存する。
  useDebouncedSave(FILTER_CACHE_KEY, {
    selectedPrefs,
    selectedCities,
    showFavOnly,
    ageMin,
    ageMax,
    keyword,
    quitDetailKeyword,
    selectedDai,
    selectedChu,
    selectedSho,
    sortKey,
    sortOrder,
    hasSearched,
  });

  // ページング
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    [filtered.length]
  );
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);
  const startIndex = useMemo(
    () => (filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0),
    [filtered.length, currentPage]
  );
  const endIndex = useMemo(
    () => Math.min(currentPage * PAGE_SIZE, filtered.length),
    [filtered.length, currentPage]
  );
  useEffect(() => {
    // 件数が変わったら currentPage を範囲内に補正
    setCurrentPage((p) => {
      const newTotal = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      return Math.min(p, newTotal);
    });
  }, [filtered]);

  const handlePageChange = useCallback((page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // 畳んだときに表示する条件サマリ
  const searchSummary = useMemo(() => {
    const parts = [];
    if (showFavOnly) parts.push("★ お気に入りのみ");
    if (selectedPrefs.length) parts.push(selectedPrefs.join("・"));
    if (selectedCities.length) {
      parts.push(
        selectedCities.length > 3
          ? `${selectedCities.slice(0, 3).join("・")} 他${selectedCities.length - 3}件`
          : selectedCities.join("・")
      );
    }
    if (ageMin !== "" || ageMax !== "") {
      parts.push(`${ageMin || "下限なし"}〜${ageMax || "上限なし"}歳`);
    }
    if (keyword.trim()) parts.push(`「${keyword.trim()}」`);
    if (quitDetailKeyword.trim()) parts.push(`詳細「${quitDetailKeyword.trim()}」`);
    const kubun = [];
    if (selectedDai.length) kubun.push(`大${selectedDai.length}`);
    if (selectedChu.length) kubun.push(`中${selectedChu.length}`);
    if (selectedSho.length) kubun.push(`小${selectedSho.length}`);
    if (kubun.length) parts.push(`離脱判断 ${kubun.join("/")}件選択`);
    return parts.length ? parts.join(" ｜ ") : "条件指定なし";
  }, [
    showFavOnly,
    selectedPrefs,
    selectedCities,
    ageMin,
    ageMax,
    keyword,
    quitDetailKeyword,
    selectedDai,
    selectedChu,
    selectedSho,
  ]);

  // その他
  const [errorMessage, setErrorMessage] = useState("");
  const [needReauth, setNeedReauth] = useState(false);

  // モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null); // 'dai' | 'chu' | 'sho'
  const [modalTempSelection, setModalTempSelection] = useState([]);
  const [modalSearch, setModalSearch] = useState("");

  // 都道府県の変更で候補外の市区町村を自動除外
  useEffect(() => {
    if (!areaMap || !Object.keys(areaMap).length) return;
    setSelectedCities((prev) => sanitizeCitySelection(areaMap, selectedPrefs, prev));
  }, [areaMap, selectedPrefs]);

  /* ====== 並び替え ======
     favorites を参照するため useCallback でラップする。
     以前は素の関数のうえ再ソートの effect が [sortKey, sortOrder] しか
     見ていなかったため、「お気に入り順」で★を付け替えても並びが
     変わらなかった。 */
  const sortPartners = useCallback((list, key, order) => {
    const getVal = (p) => {
      if (key === "_favorite") {
        // お気に入り: 1 / 非お気に入り: 0
        return favorites.has(getPartnerKey(p)) ? 1 : 0;
      }
      if (key === "Now_Age__c") return Number(p["Now_Age__c"]) || -Infinity;
      if (key === "ExitDate__c") {
        const v = pick(p, EXIT_DATE_KEYS);
        return v ? new Date(v).getTime() : -Infinity;
      }
      if (key === "最終稼働日") {
        const v = p["最終稼働日"]; // 正規化済みのため、このキーで拾える
        return v ? new Date(v).getTime() : -Infinity;
      }
      if (key === "ApprovalDate__c") {
        const v = p["ApprovalDate__c"];
        return v ? new Date(v).getTime() : -Infinity;
      }
      if (key === "Address__c") {
        const addr =
          p["MailingState"] || p["MailingCity"] || p["MailingStreet"]
            ? `${p["MailingState"] || ""}${p["MailingCity"] || ""}${p["MailingStreet"] || ""}`
            : p["Address__c"] || "";
        return addr;
      }
      if (key === "Name") return String(p["Name"] || "");
      return String(p[key] || "");
    };
    return [...list].sort((a, b) => {
      const A = getVal(a);
      const B = getVal(b);
      if (typeof A === "number" && typeof B === "number") {
        return order === "asc" ? A - B : B - A;
      }
      return order === "asc" ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
    });
  }, [favorites]);

  // ヘッダクリックで昇降トグル
  const toggleSort = (key) => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    setSortKey(key);
  };
  const sortCaret = (key) => (sortKey === key ? (sortOrder === "asc" ? " ▲" : " ▼") : "");

  // 並び替え条件・お気に入り・検索結果のいずれかが変わったら再ソート
  useEffect(() => {
    setFiltered(sortPartners(rawFiltered, sortKey, sortOrder));
  }, [rawFiltered, sortKey, sortOrder, sortPartners]);

/* ====== 検索 ====== */
const handleSearch = () => {
  setErrorMessage("");
  if (!hasSearched) setHasSearched(true);

  if (!exitedReadyRef.current) {
    pendingExitedSearchRef.current = true;
    setIsLoading(true);
    return;
  }

  pendingExitedSearchRef.current = false;
  setIsLoading(true);

  const favoritesFlag = showFavOnly;
  const searchParamsSnapshot = {
    selectedPrefs: [...selectedPrefs],
    selectedCities: [...selectedCities],
    selectedDistricts: [...selectedCities],
    selectedDai: [...selectedDai],
    selectedChu: [...selectedChu],
    selectedSho: [...selectedSho],
    ageMin,
    ageMax,
    keyword,
    quitDetailKeyword,
    favoritesOnly: favoritesFlag,
    sortKey,
    sortOrder,
  };
  const keywordParts = [];
  if (favoritesFlag) keywordParts.push("お気に入りのみ");
  if (selectedPrefs.length) keywordParts.push(`都道府県:${selectedPrefs.join("/")}`);
  if (selectedCities.length) keywordParts.push(`市区町村:${selectedCities.join("/")}`);
  if (selectedDai.length) keywordParts.push(`離脱大分類:${selectedDai.join("/")}`);
  if (selectedChu.length) keywordParts.push(`離脱中分類:${selectedChu.join("/")}`);
  if (selectedSho.length) keywordParts.push(`離脱小分類:${selectedSho.join("/")}`);
  if (ageMin || ageMax) keywordParts.push(`年齢:${ageMin || "--"}〜${ageMax || "--"}`);
  if (keyword.trim()) keywordParts.push(`キーワード:${keyword.trim()}`);
  if (quitDetailKeyword.trim()) keywordParts.push(`離脱理由詳細:${quitDetailKeyword.trim()}`);
  const keywordLabel = keywordParts.join(" | ");
  const pageUrl = typeof window !== "undefined" ? window.location.pathname : "";
  const startedAt = performance.now();

  // くるくる表示のため一旦次フレームに回す
  setTimeout(() => {
    const result = exitedPartners.filter((p) => {
      // 住所
      const prefVal = pick(p, ["MailingState", "都道府県"]);
      const cityVal = pick(p, ["MailingCity", "市区町村"]);
      if (selectedPrefs.length && !selectedPrefs.includes(prefVal)) return false;
      if (selectedCities.length && !selectedCities.includes(cityVal)) return false;

      // 年齢
      const bound = ageMin !== "" || ageMax !== "";
      if (bound) {
        const age = Number(p["Now_Age__c"]);
        const minOk = ageMin === "" ? true : age >= Number(ageMin);
        const maxOk = ageMax === "" ? true : age <= Number(ageMax);
        if (Number.isNaN(age) || !(minOk && maxOk)) return false;
      }

      // 離脱理由
      if (selectedDai.length && !selectedDai.includes(p["Quit_Dai__c"])) return false;
      if (selectedChu.length && !selectedChu.includes(p["Quit_chu__c"])) return false;
      if (selectedSho.length && !selectedSho.includes(p["Quit_sho__c"])) return false;

      // 離脱理由（詳細）
      if (quitDetailKeyword.trim() !== "") {
        const qd = quitDetailKeyword.toLowerCase();
        const detail = String(p["Quit_detail__c"] || "").toLowerCase();
        if (!detail.includes(qd)) return false;
      }

      // 自由キーワード
      if (keyword.trim() !== "") {
        const q = keyword.toLowerCase();
        const hay = [
          p["Name"],
          p["Name__c"],
          p["Address__c"],
          p["DriverSituation__c"],
          pick(p, ["ExitReason__c", "離脱理由", "退職理由"]),
          p["MailingState"],
          p["MailingCity"],
          p["MailingStreet"],
          p["Quit_detail__c"],
          p["直近案件"],
          p["直近稼働"],
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // お気に入りのみ
      if (favoritesFlag && !favorites.has(getPartnerKey(p))) return false;

      return true;
    });

    setRawFiltered(result);
    setFiltered(sortPartners(result, sortKey, sortOrder));
    setCurrentPage(1); // 結果表示開始は1ページ目に戻す
    setIsLoading(false);
    // 結果があるときだけ畳む。0件なら条件を直したいはずなので開いたままにする
    setPanelOpen(result.length === 0);

    if (effectiveUserId) {
      const elapsed = Math.round(performance.now() - startedAt);
      addSearchHistory({
        userId: effectiveUserId,
        pageKey: SEARCH_HISTORY_PAGE_KEY,
        searchParams: searchParamsSnapshot,
        executedAt: new Date().toISOString(),
        resultCount: result.length,
        elapsedMs: elapsed,
        pageUrl,
        keyword: keywordLabel || undefined,
      }).catch((error) => {
        console.error("検索履歴の保存に失敗しました", error);
      });
    }
  }, 0);
};

  useEffect(() => {
    if (!exitedReadyRef.current) return;
    if (!pendingExitedSearchRef.current) return;
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitedPartners]);


  const userEmail = localStorage.getItem("userEmail") || "未取得";
  const effectiveUserId = userEmail && userEmail !== "未取得" ? userEmail : "";

  /* ====== モーダル ====== */
  const openModal = (type) => {
    if (type === "pref" || type === "city") {
      setLocationModalType(type);
      return;
    }
    setModalType(type);
    setModalSearch("");
    if (type === "dai") setModalTempSelection(selectedDai);
    if (type === "chu") setModalTempSelection(selectedChu);
    if (type === "sho") setModalTempSelection(selectedSho);
    setModalOpen(true);
  };

  const closeLocationModal = () => {
    setLocationModalType(null);
  };

  const handleApplyLocationModal = (values) => {
    if (!locationModalType) return;
    if (locationModalType === "pref") {
      setSelectedPrefs(values);
      setSelectedCities((prev) => sanitizeCitySelection(areaMap, values, prev));
    } else if (locationModalType === "city") {
      setSelectedCities(values);
    }
    setLocationModalType(null);
  };

  const applyHistoryParams = (params = {}) => {
    if (!params || typeof params !== "object") return;
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(params, key);

    if (Array.isArray(params.selectedPrefs)) {
      setSelectedPrefs([...params.selectedPrefs]);
    }
    if (Array.isArray(params.selectedCities)) {
      setSelectedCities([...params.selectedCities]);
    } else if (Array.isArray(params.selectedDistricts)) {
      setSelectedCities([...params.selectedDistricts]);
    }
    if (Array.isArray(params.selectedDai)) {
      setSelectedDai([...params.selectedDai]);
    }
    if (Array.isArray(params.selectedChu)) {
      setSelectedChu([...params.selectedChu]);
    }
    if (Array.isArray(params.selectedSho)) {
      setSelectedSho([...params.selectedSho]);
    }
    if (hasOwn("ageMin")) {
      setAgeMin(
        params.ageMin === undefined || params.ageMin === null
          ? ""
          : String(params.ageMin)
      );
    }
    if (hasOwn("ageMax")) {
      setAgeMax(
        params.ageMax === undefined || params.ageMax === null
          ? ""
          : String(params.ageMax)
      );
    }
    if (hasOwn("keyword")) {
      setKeyword(
        params.keyword === undefined || params.keyword === null
          ? ""
          : String(params.keyword)
      );
    }
    if (hasOwn("quitDetailKeyword")) {
      setQuitDetailKeyword(
        params.quitDetailKeyword === undefined || params.quitDetailKeyword === null
          ? ""
          : String(params.quitDetailKeyword)
      );
    }
    if (hasOwn("favoritesOnly")) {
      setShowFavOnly(!!params.favoritesOnly);
    }
    if (typeof params.sortKey === "string" && params.sortKey) {
      setSortKey(params.sortKey);
    }
    if (typeof params.sortOrder === "string" && params.sortOrder) {
      setSortOrder(params.sortOrder);
    }
  };

  const handleApplyHistoryOnly = (params = {}) => {
    applyHistoryParams(params);
  };

  const handleApplyHistoryWithSearch = (params = {}) => {
    applyHistoryParams(params);
    setTimeout(() => handleSearch(), 0);
  };

  const applyModal = () => {
    if (modalType === "dai") setSelectedDai(modalTempSelection);
    if (modalType === "chu") setSelectedChu(modalTempSelection);
    if (modalType === "sho") setSelectedSho(modalTempSelection);
    setModalOpen(false);
  };

  const summary = (label, arr) => `${label}${arr.length ? `（${arr.length}件選択）` : "（未選択）"}`;

  const modalTitle =
    modalType === "dai" ? "離脱判断（大区分）"
    : modalType === "chu" ? "離脱判断（中区分）"
    : modalType === "sho" ? "離脱判断（小区分）" : "";

  const modalOptions = useMemo(() => {
    const q = modalSearch.trim();
    if (modalType === "dai") {
      const base = Q_DAI_OPTIONS;
      return q ? base.filter((x) => x.includes(q)) : base;
    }
    if (modalType === "chu") {
      // グループ（表示は短縮、内部値はフル複数）
      const base = Q_CHU_GROUPS;
      return q ? base.filter((g) => g.label.includes(q) || g.values.some((v) => v.includes(q))) : base;
    }
    if (modalType === "sho") {
      const base = Q_SHO_OPTIONS;
      return q ? base.filter((x) => x.includes(q)) : base;
    }
    return [];
  }, [modalType, modalSearch]);

  const toggleTemp = (val, checked) => {
    setModalTempSelection((prev) => (checked ? [...prev, val] : prev.filter((x) => x !== val)));
  };

  const toggleChuGroup = (values, checked) => {
    setModalTempSelection((prev) => {
      const set = new Set(prev);
      if (checked) values.forEach((v) => set.add(v));
      else values.forEach((v) => set.delete(v));
      return Array.from(set);
    });
  };

  const renderOption = (opt) => {
    if (modalType === "chu") {
      const values = opt.values; // フル文言の配列
      const allIncluded = values.every((v) => modalTempSelection.includes(v));
      const anyIncluded = values.some((v) => modalTempSelection.includes(v));
      const optionStyle =
        allIncluded
          ? { ...styles.optionItem, ...styles.optionItemActive }
          : anyIncluded
          ? { ...styles.optionItem, ...styles.optionItemPartial }
          : styles.optionItem;

      return (
        <label
          key={opt.label}
          style={optionStyle}
          className="chip"
          title={values.join(" / ")}
        >
          <input
            type="checkbox"
            checked={allIncluded}
            onChange={(e) => toggleChuGroup(values, e.target.checked)}
          />
          <span>
            {opt.label}
            {values.length > 1 && (
              <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 6 }}>
                （{values.length} 件）
                {anyIncluded && !allIncluded ? "※一部選択" : ""}
              </span>
            )}
          </span>
        </label>
      );
    }

    // それ以外は通常の単一チェック
    const val = opt;
    const checked = modalTempSelection.includes(val);
    const optionStyle = checked
      ? { ...styles.optionItem, ...styles.optionItemActive }
      : styles.optionItem;

    return (
      <label key={val} style={optionStyle} className="chip">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => toggleTemp(val, e.target.checked)}
        />
        <span>{val}</span>
      </label>
    );
  };

  return (
    <>
      <HeaderMenu title="離脱パートナー検索" />

      <div className="availability-page">
        <ScrollTopButton />
        <PullToRefresh onRefresh={() => loadData({ force: true })} />

        {needReauth && <SessionExpiredNotice onRetry={() => loadData({ force: true })} />}

        {/* 検索後はパネルを畳み、条件サマリだけ見せて結果を前に出す */}
        {!panelOpen && (
          <div className="search-summary">
            <div className="search-summary__text">{searchSummary}</div>
            <button
              type="button"
              className="search-summary__toggle"
              onClick={() => setPanelOpen(true)}
            >
              条件を変更
            </button>
          </div>
        )}

        {/* ===== 検索パネル ===== */}
        {panelOpen && (
        <div className="search-panel">
          {/* 住所：おしゃれチップ → モーダル（複数選択） */}
          <div style={{ marginTop: 4 }}>
            <div style={styles.chipRow}>
              <button className="chip-like" style={styles.chip} onClick={() => openModal("pref")}>
                {summary("都道府県", selectedPrefs)}
              </button>
              <button className="chip-like" style={styles.chip} onClick={() => openModal("city")}>
                {summary("市区町村", selectedCities)}
              </button>
            </div>
            <div style={styles.hint}>※ 都道府県・市区町村ともに複数選択可。</div>
          </div>

          {/* 年齢 */}
          <div className="age-range-section" style={{ marginTop: 12 }}>
            <label className="age-label">年齢</label>
            <div className="age-input-row">
              <input type="number" min="0" inputMode="numeric" placeholder="下限"
                     value={ageMin} onChange={(e) => setAgeMin(e.target.value)} className="age-input" />
              <span className="age-tilde">～</span>
              <input type="number" min="0" inputMode="numeric" placeholder="上限"
                     value={ageMax} onChange={(e) => setAgeMax(e.target.value)} className="age-input" />
              
              <button type="button" className="clear-btn" onClick={() => { setAgeMin(""); setAgeMax(""); }} style={{ marginLeft: 8 }} disabled={ageMin === "" && ageMax === ""}>
                クリア
              </button>
            </div>
          </div>

          {/* キーワード */}
          <div className="keyword-row" style={{ marginTop: 10 }}>
            <label>キーワード</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                className="keyword-input"
                placeholder="名前・住所・最終案件名等"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={{ flex: "1 1 260px", minWidth: 200 }}
              />
              <button
                type="button"
                className="clear-btn"
                onClick={() => setKeyword("")}
                disabled={!keyword}
              >
                クリア
              </button>
            </div>
          </div>

          {/* 離脱判断（詳細） */}
          <div className="keyword-row" style={{ marginTop: 10 }}>
            <label>離脱判断（詳細）</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                className="keyword-input"
                placeholder="詳細テキストで検索"
                value={quitDetailKeyword}
                onChange={(e) => setQuitDetailKeyword(e.target.value)}
                style={{ flex: "1 1 260px", minWidth: 200 }}
              />
              <button
                type="button"
                className="clear-btn"
                onClick={() => setQuitDetailKeyword("")}
                disabled={!quitDetailKeyword}
              >
                クリア
              </button>
            </div>
          </div>

          {/* 離脱区分：おしゃれチップ → モーダル */}
          <div style={{ marginTop: 12 }}>
            <div style={styles.chipRow}>
              <button className="chip-like" style={styles.chip} onClick={() => openModal("dai")}>
                {summary("離脱判断（大区分）", selectedDai)}
              </button>
              <button className="chip-like" style={styles.chip} onClick={() => openModal("chu")}>
                {summary("離脱判断（中区分）", selectedChu)}
              </button>
              <button className="chip-like" style={styles.chip} onClick={() => openModal("sho")}>
                {summary("離脱判断（小区分）", selectedSho)}
              </button>
            </div>
          </div>

          {/* 実行 */}
          <div className="search-button-wrapper">
            {errorMessage && <div className="error-message">{errorMessage}</div>}

<div
  className="fav-only"
  style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
>
  <input
    id="favOnly"
    type="checkbox"
    checked={showFavOnly}
    onChange={(e) => setShowFavOnly(e.target.checked)}
    style={{ margin: 0, display: "inline-block" }}
  />
  <label
    htmlFor="favOnly"
    style={{ margin: 0, display: "inline-block", cursor: "pointer" }}
  >
    お気に入りのみ表示
  </label>
</div>



            <button className="search" onClick={handleSearch}>検索</button>
            <button
              className="history-button"
              type="button"
              onClick={() => setHistoryModalOpen(true)}
            >
              検索履歴
            </button>
          </div>
        </div>
        )}

        {/* ===== 検索前ガイダンス／ローディング ===== */}
        {!hasSearched && !isLoading && (
          <div className="presearch-hint">🔍 条件を指定して「検索」を押してください</div>
        )}
        {isLoading && (
          <div className="loading-box">
            <div className="spinner" />
            <div className="loading-text">検索中...</div>
          </div>
        )}

        {/* 件数と並び替えは検索条件ではないので、結果リストの直上に置く。
            テーブルのヘッダクリックでも並び替えできるが、狭い画面では
            横スクロールしないとヘッダに届かないため、ここにも残している。 */}
        {hasSearched && !isLoading && !needReauth && (
          <div className="result-toolbar">
            <div className="result-toolbar__count">
              <strong>{filtered.length}</strong> 件
              {filtered.length > 0 && (
                <span className="result-toolbar__range">
                  （{startIndex}–{endIndex} 件を表示／{currentPage} / {totalPages}ページ）
                </span>
              )}
            </div>

            <div className="result-toolbar__controls">
              <div className="sort-controls">
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  aria-label="並び替え"
                >
                  <option value="_favorite">お気に入り</option>
                  <option value="ExitDate__c">離脱日</option>
                  <option value="Name">名前</option>
                  <option value="Now_Age__c">年齢</option>
                  <option value="Gender__c">性別</option>
                  <option value="ApprovalDate__c">承認日</option>
                  <option value="最終稼働日">最終稼働日</option>
                  <option value="Address__c">住所</option>
                </select>
                <button
                  type="button"
                  className={`order-toggle ${sortOrder}`}
                  onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                >
                  {sortOrder === "asc" ? "▲ 昇順" : "▼ 降順"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== TOP ページャ（リスト上） ===== */}
        {hasSearched && !isLoading && filtered.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={handlePageChange}
          />
        )}

        {/* ===== テーブル ===== */}
        <div style={{ marginTop: 16 }}>
          {!hasSearched || needReauth ? null : filtered.length === 0 && !isLoading ? (
            <div style={{ textAlign: "center", marginTop: 20 }}>該当するパートナーはいません</div>
          ) : isLoading ? null : isNarrow ? (
            /* 狭い画面：11列の表は読めないのでカードに描き分ける */
            <div className="wd-cards">
              {pagedRows.map((p, idx) => (
                <WithdrawnCard
                  key={`${p["SF_ID__c"] || p["Name"]}-${(currentPage - 1) * PAGE_SIZE + idx}`}
                  view={buildRowView(p)}
                  favorite={isFav(p)}
                  onToggleFavorite={() => toggleFavorite(p)}
                />
              ))}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table} className="result-table">
                <thead>
                  <tr>
<th onClick={() => toggleSort("_favorite")} style={styles.thClickable}>★{sortCaret("_favorite")}</th>

                    <th onClick={() => toggleSort("Name")} style={styles.thClickable}>氏名{sortCaret("Name")}</th>
                    <th onClick={() => toggleSort("Now_Age__c")} style={styles.thClickable}>年齢{sortCaret("Now_Age__c")}</th>
                    <th onClick={() => toggleSort("Gender__c")} style={styles.thClickable}>性別{sortCaret("Gender__c")}</th>
                    <th onClick={() => toggleSort("Address__c")} style={styles.thClickable}>住所{sortCaret("Address__c")}</th>
                    <th>携帯</th>
                    <th onClick={() => toggleSort("ApprovalDate__c")} style={styles.thClickable}>承認日{sortCaret("ApprovalDate__c")}</th>
                    <th onClick={() => toggleSort("最終稼働日")} style={styles.thClickable}>最終稼働日{sortCaret("最終稼働日")}</th>
                    <th onClick={() => toggleSort("ExitDate__c")} style={styles.thClickable}>離脱日{sortCaret("ExitDate__c")}</th>
                    <th>判断（大/中/小）</th>
                    <th>判断（詳細）</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((p, idx) => {
                    const v = buildRowView(p);
                    return (
                      <tr key={`${v.partnerId || v.name}-${(currentPage - 1) * PAGE_SIZE + idx}`}>
                        <td style={{ textAlign: "center" }}>
                          <button
                            className={`star-btn ${isFav(p) ? "on" : ""}`}
                            onClick={() => toggleFavorite(p)}
                            title={isFav(p) ? "お気に入り解除" : "お気に入りに追加"}
                            aria-label="favorite"
                          >
                            {isFav(p) ? "★" : "☆"}
                          </button>
                        </td>

                        {/* 氏名：かな（上）＋氏名（下） */}
                        <td style={{ minWidth: 140 }}>
                          {v.kana && <div className="kana-small">{v.kana}</div>}
                          <div>
                            {v.partnerId ? (
                              <ConfirmLink
                                href={sfContactUrl(v.partnerId)}
                                description={`${v.name} さんのパートナー情報`}
                                className="name-link"
                              >
                                {v.name}
                              </ConfirmLink>
                            ) : (
                              v.name
                            )}
                          </div>
                        </td>

                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{v.age}</td>
                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{v.gender}</td>

                        {/* 住所：狭め＆折返し */}
                        <td style={{ minWidth: 300, whiteSpace: "normal", wordBreak: "break-word" }}>
                          {v.addrFull}
                        </td>

                        <td style={{ whiteSpace: "nowrap" }}>
                          {v.phone ? (
                            <a href={`tel:${v.phone}`}>{v.phone}</a>
                          ) : (
                            <span style={{ color: "#990000" }}>なし</span>
                          )}
                        </td>

                        <td style={{ whiteSpace: "nowrap" }}>
                          {v.approval ? formatDate(v.approval) : "不明"}
                        </td>

                        <td style={{ textAlign: "center", whiteSpace: "nowrap", color: v.lastWorkDate ? undefined : "#990000" }}>
                          {v.lastWorkDate ? formatDate(v.lastWorkDate) : "-"}
                        </td>

                        <td style={{ whiteSpace: "nowrap", color: v.exitDate ? undefined : "#990000" }}>
                          {v.exitDate ? formatDate(v.exitDate) : "不明"}
                        </td>

                        <td style={{ minWidth: 280 }}>
                          {(v.quitDai || "-")} / {(shortLabel(v.quitChu) || "-")} / {(v.quitSho || "—")}
                        </td>

                        {/* 判断（詳細）：ワイド */}
                        <td style={{ minWidth: 420, whiteSpace: "normal", wordBreak: "break-word" }}>
                          {v.quitDetail}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ===== BOTTOM ページャ（リスト下） ===== */}
        {hasSearched && !isLoading && filtered.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={handlePageChange}
          />
        )}
      </div>

      {/* === 共通モーダル === */}
      <Modal open={modalOpen} title={modalTitle} onClose={() => setModalOpen(false)} onApply={applyModal}>
        {/* 検索＋全選択＋クリア */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            type="text"
            placeholder="候補検索（絞り込み）"
            value={modalSearch}
            onChange={(e) => setModalSearch(e.target.value)}
            className="keyword-input"
            style={{ flex: 1, minWidth: 120 }}
          />
          <button
            className="clear-btn"
            onClick={() => {
              // 全選択は「今表示されている候補のみ」
              if (modalType === "chu") {
                const allValues = modalOptions.flatMap((g) => g.values);
                setModalTempSelection((prev) => Array.from(new Set([...prev, ...allValues])));
              } else {
                setModalTempSelection(modalOptions.slice());
              }
            }}
          >
            全選択
          </button>
          <button className="clear-btn" onClick={() => setModalTempSelection([])}>クリア</button>
        </div>

        {/* 候補 */}
        <div style={styles.optionList}>
          {modalOptions.map((opt) => renderOption(opt))}
        </div>

        {/* サマリ */}
        <div style={styles.selectionSummary}>選択中：{modalTempSelection.length} 件</div>
      </Modal>
      <LocationSelectorModal
        key={locationModalType || "none"}
        isOpen={Boolean(locationModalType)}
        title={
          locationModalType === "pref"
            ? "都道府県を選択"
            : locationModalType === "city"
            ? "市区町村を選択"
            : ""
        }
        options={
          locationModalType === "pref" ? allPrefList : cityCandidates
        }
        selectedValues={
          locationModalType === "pref"
            ? selectedPrefs
            : selectedCities
        }
        onClose={closeLocationModal}
        onApply={handleApplyLocationModal}
        searchPlaceholder={
          locationModalType === "pref"
            ? "都道府県名を検索"
            : "市区町村名を検索"
        }
      />
      <SearchHistoryModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        userId={effectiveUserId}
        pageKey={SEARCH_HISTORY_PAGE_KEY}
        onApply={handleApplyHistoryOnly}
        onSearch={handleApplyHistoryWithSearch}
      />
    </>
  );
}

/* ====== スタイル ====== */
const styles = {
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  chip: {
    border: "1px solid #ddd",
    borderRadius: 9999,
    padding: "8px 12px",
    background: "white",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    cursor: "pointer",
  },
  hint: { fontSize: 12, opacity: 0.75, marginTop: 6 },

  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    width: "min(1000px, 96vw)",
    background: "white",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  modalContent: {
    overflow: "auto",
    border: "1px solid #eee",
    borderRadius: 12,
    padding: 12,
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  optionList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 8,
  },
  optionItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #e5e7eb",
    borderRadius: 9999,
    padding: "6px 10px",
    background: "#fff",
    whiteSpace: "nowrap",
    transition: "background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease",
  },
  optionItemActive: {
    background: "#e8f2ff",
    borderColor: "#93c5fd",
    boxShadow: "0 0 0 1px rgba(59, 130, 246, 0.35)",
    color: "#1d4ed8",
    fontWeight: 600,
  },
  optionItemPartial: {
    background: "#f3f4ff",
    borderColor: "#c7d2fe",
    boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.3)",
    color: "#3730a3",
    fontWeight: 600,
  },
  selectionSummary: {
    marginTop: 8,
    fontSize: 12,
    opacity: 0.8,
    textAlign: "right",
  },

  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 14,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    overflow: "hidden",
  },
  thClickable: {
    cursor: "pointer",
    userSelect: "none",
  },
};

