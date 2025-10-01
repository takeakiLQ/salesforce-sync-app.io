import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./Withdrawn.css";
import HeaderMenu from "./HeaderMenu";
import LocationSelectorModal from "./LocationSelectorModal";
import SearchHistoryModal from "./SearchHistoryModal";
import { useNavigate } from "react-router-dom";
import { fetchPrefectureCityMap, buildCityCandidates, sanitizeCitySelection } from "../utils/locationOptions";
import { addSearchHistory } from "../utils/searchHistoryApi";

// ...既存のロジック...

const SPREADSHEET_ID = process.env.REACT_APP_SPREADSHEET_ID;
const SHEET_EXITED = "離脱パートナー";
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

  // 離脱パートナー取得
  const fetchExited = async () => {
    exitedReadyRef.current = false;
    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("NO_TOKEN");
      // ★ 2万行まで取得（列オープン）
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_EXITED}!A1:20000`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });

      const values = res.data.values || [];
      const header = values[0] || [];
      const rows = values.slice(1);

      // ヘッダ正規化：全角→半角、trim、空白除去
      const normKey = (s) =>
        String(s || "")
          .replace(/\u3000/g, " ")
          .trim()
          .replace(/\s+/g, "");

      const headerLen = header.length;
      const data = rows.map((row) => {
        // 行末をヘッダ長までパディング（Google Sheetsの行末切り詰め対策）
        const r = row.slice();
        if (r.length < headerLen) r.push(...Array(headerLen - r.length).fill(""));
        const obj = {};
        for (let i = 0; i < headerLen; i++) {
          const rawKey = header[i] ?? "";
          const val = r[i] ?? "";
          obj[rawKey] = val;             // 元キー
          obj[normKey(rawKey)] = val;    // 正規化キー（例: "最終 稼働日"→"最終稼働日"）
        }
        return obj;
      });
      setExitedPartners(data);
    } catch (e) {
      console.error("fetchExited error:", e);
      setExitedPartners([]);
      setErrorMessage("離脱パートナー情報の取得に失敗しました。再認証してください。");
      setNeedReauth(true);
    } finally {
      exitedReadyRef.current = true;
    }
  };

  useEffect(() => {
    fetchExited();
  }, []);
  const navigate = useNavigate();

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
  const pendingExitedSearchRef = useRef(false);

  // 検索結果（初期表示は空）
  const [filtered, setFiltered] = useState([]);
  const [rawFiltered, setRawFiltered] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

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

  useEffect(() => {
    try {
      const payload = {
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
      };
      localStorage.setItem(FILTER_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Failed to cache withdrawn filters", error);
    }
  }, [
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
  ]);

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

  // その他
  const [menuOpen, setMenuOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [needReauth, setNeedReauth] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null); // 'dai' | 'chu' | 'sho'
  const [modalTempSelection, setModalTempSelection] = useState([]);
  const [modalSearch, setModalSearch] = useState("");

  /* ====== スクロールトップ ====== */
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* ====== 都道府県マスタ ====== */
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetchPrefectureCityMap({ token })
      .then(setAreaMap)
      .catch((err) => {
        console.error("fetchAreaMap error:", err);
        setErrorMessage("エリア情報の取得に失敗しました。再認証してください。");
        setNeedReauth(true);
      });
  }, []);

  /* ====== 離脱パートナー取得（初期表示は空） ====== */
  useEffect(() => {
    fetchExited();
  }, [areaMap, selectedPrefs, allPrefList]);

  // 都道府県の変更で候補外の市区町村を自動除外
  useEffect(() => {
    if (!areaMap || !Object.keys(areaMap).length) return;
    setSelectedCities((prev) => sanitizeCitySelection(areaMap, selectedPrefs, prev));
  }, [areaMap, selectedPrefs]);

  /* ====== 並び替え ====== */
  const sortPartners = (list, key, order) => {
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
  };

  // ヘッダクリックで昇降トグル
  const toggleSort = (key) => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    setSortKey(key);
  };
  const sortCaret = (key) => (sortKey === key ? (sortOrder === "asc" ? " ▲" : " ▼") : "");

  // 並び替え変更で再ソート
  useEffect(() => {
    setFiltered(sortPartners(rawFiltered, sortKey, sortOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortOrder]);

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


/* ====== ナビ ====== */
const handleLogout = () => {
  // 認証関連だけ削除（トークンやメール）
  localStorage.removeItem("token");
  localStorage.removeItem("userEmail");
  // localStorage.clear() は使わない！
  navigate("/");
};

  const handleNavigateHome = () => navigate("/home");

  const userEmail = localStorage.getItem("userEmail") || "未取得";
  const userNameOnly = userEmail.includes("@") ? userEmail.split("@")[0] : userEmail;
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
      <HeaderMenu
        title="離脱パートナー検索"
        userName={userNameOnly}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onNavigateHome={handleNavigateHome}
        onLogout={handleLogout}
        onNavigateAvailability={() => navigate("/availability")}
        onNavigateWithdrawn={() => navigate("/withdrawn")}
        onNavigateAnalysis={() => navigate("/general-analysis")}
        onNavigateAnken={() => navigate("/subcontractor-analysis")}
      />

      <div className="availability-page">
        {showScrollTop && (
          <button className="scroll-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            検索パネルに戻る
          </button>
        )}

        {/* ===== 検索パネル ===== */}
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

          {/* 並び替え＆実行 */}
          <div className="search-button-wrapper">
            {errorMessage && <div className="error-message">{errorMessage}</div>}
            {needReauth && (
              <button className="menu-button" onClick={() => { localStorage.removeItem("token"); navigate("/"); }}>
                Google再認証
              </button>
            )}

            <div className="sort-controls" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                <option value="_favorite">お気に入り</option>
                <option value="ExitDate__c">離脱日</option>
                <option value="Name">名前</option>
                <option value="Now_Age__c">年齢</option>
                <option value="Gender__c">性別</option>
                <option value="ApprovalDate__c">承認日</option>
                <option value="最終稼働日">最終稼働日</option>
                <option value="Address__c">住所</option>
              </select>
              <button className={`order-toggle ${sortOrder}`} onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}>
                {sortOrder === "asc" ? "▲ 昇順" : "▼ 降順"}
              </button>
            </div>

            {hasSearched && !isLoading && (
              <div className="result-count">
                検索結果：{filtered.length} 件（{startIndex}–{endIndex} 件を表示）<br />
                ページ： {currentPage} / {totalPages}
              </div>
            )}

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

        {/* ===== TOP ページャ（リスト上） ===== */}
        {hasSearched && !isLoading && filtered.length > 0 && (
          <div className="pagination">
            <button
              className="page-btn"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              前へ
            </button>

            {(() => {
              const items = [];
              const maxButtons = 7;
              if (totalPages <= maxButtons) {
                for (let i = 1; i <= totalPages; i++) items.push(i);
              } else {
                const left = Math.max(2, currentPage - 1);
                const right = Math.min(totalPages - 1, currentPage + 1);
                items.push(1);
                if (left > 2) items.push("…");
                for (let i = left; i <= right; i++) items.push(i);
                if (right < totalPages - 1) items.push("…");
                items.push(totalPages);
              }
              return items.map((it, idx) =>
                it === "…" ? (
                  <span key={`e-${idx}`} className="page-ellipsis">…</span>
                ) : (
                  <button
                    key={it}
                    className={`page-btn ${it === currentPage ? "active" : ""}`}
                    onClick={() => setCurrentPage(it)}
                  >
                    {it}
                  </button>
                )
              );
            })()}

            <button
              className="page-btn"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              次へ
            </button>
          </div>
        )}

        {/* ===== テーブル ===== */}
        <div style={{ marginTop: 16 }}>
          {!hasSearched ? null : filtered.length === 0 && !isLoading ? (
            <div style={{ textAlign: "center", marginTop: 20 }}>該当するパートナーはいません</div>
          ) : !isLoading ? (
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
                    
                    const partnerId = p["SF_ID__c"];
                    const name = p["Name"] || "氏名不明";
                    const kana = p["Name__c"] || "";
                    const age = p["Now_Age__c"] || "";
                    const gender = p["Gender__c"] || "";

                    const prefVal = pick(p, ["MailingState", "都道府県"]);
                    const cityVal = pick(p, ["MailingCity", "市区町村"]);
                    const streetVal = p["MailingStreet"] || "";
                    const addrFull =
                      prefVal || cityVal || streetVal
                        ? `${prefVal || ""}${cityVal || ""}${streetVal || ""}`
                        : p["Address__c"] || "";

                    const phone = p["MobilePhone"];
                    const approval = p["ApprovalDate__c"];
                    const exitDate = pick(p, EXIT_DATE_KEYS);
                    const lastWorkDate = p["最終稼働日"]; // 正規化済み

                    const quitDai = p["Quit_Dai__c"] || "";
                    const quitChu = p["Quit_chu__c"] || "";
                    const quitSho = p["Quit_sho__c"] || "";
                    const quitDetail = p["Quit_detail__c"] || "";

                    return (

                      
                      <tr key={`${partnerId || name}-${(currentPage - 1) * PAGE_SIZE + idx}`}>
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
                          {kana && <div className="kana-small">{kana}</div>}
                          <div>
                            {partnerId ? (
                              <a
                                href={`https://logiquest.lightning.force.com/lightning/r/Contact/${partnerId}/view`}
                                target="_blank"
                                rel="noreferrer"
                                className="name-link"
                              >
                                {name}
                              </a>
                            ) : (
                              name
                            )}
                          </div>
                        </td>

                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{age}</td>
                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>{gender}</td>

                        {/* 住所：狭め＆折返し */}
                        <td style={{ minWidth: 300, whiteSpace: "normal", wordBreak: "break-word" }}>
                          {addrFull}
                        </td>

                        <td style={{ whiteSpace: "nowrap" }}>
                          {phone ? <a href={`tel:${phone}`}>{phone}</a> : <span style={{ color: "#990000" }}>なし</span>}
                        </td>

                        <td style={{ whiteSpace: "nowrap" }}>{approval ? formatDate(approval) : "不明"}</td>

                        <td style={{ textAlign: "center", whiteSpace: "nowrap", color: lastWorkDate ? undefined : "#990000" }}>
                          {lastWorkDate ? formatDate(lastWorkDate) : "-"}
                        </td>

                        <td style={{ whiteSpace: "nowrap", color: exitDate ? undefined : "#990000" }}>
                          {exitDate ? formatDate(exitDate) : "不明"}
                        </td>

                        <td style={{ minWidth: 280 }}>
                          {(quitDai || "-")} / {(shortLabel(quitChu) || "-")} / {(quitSho || "—")}
                        </td>

                        {/* 判断（詳細）：ワイド */}
                        <td style={{ minWidth: 420, whiteSpace: "normal", wordBreak: "break-word" }}>
                          {quitDetail}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* ===== BOTTOM ページャ（リスト下） ===== */}
        {hasSearched && !isLoading && filtered.length > 0 && (
          <div className="pagination">
            <button
              className="page-btn"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              前へ
            </button>

            {(() => {
              const items = [];
              const maxButtons = 7;
              if (totalPages <= maxButtons) {
                for (let i = 1; i <= totalPages; i++) items.push(i);
              } else {
                const left = Math.max(2, currentPage - 1);
                const right = Math.min(totalPages - 1, currentPage + 1);
                items.push(1);
                if (left > 2) items.push("…");
                for (let i = left; i <= right; i++) items.push(i);
                if (right < totalPages - 1) items.push("…");
                items.push(totalPages);
              }
              return items.map((it, idx) =>
                it === "…" ? (
                  <span key={`e2-${idx}`} className="page-ellipsis">…</span>
                ) : (
                  <button
                    key={it}
                    className={`page-btn ${it === currentPage ? "active" : ""}`}
                    onClick={() => setCurrentPage(it)}
                  >
                    {it}
                  </button>
                )
              );
            })()}

            <button
              className="page-btn"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              次へ
            </button>
          </div>
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

