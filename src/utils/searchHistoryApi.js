import axios from "axios";

const API_URL = process.env.REACT_APP_SEARCH_HISTORY_API_URL;

if (!API_URL) {
  // eslint-disable-next-line no-console
  console.warn("REACT_APP_SEARCH_HISTORY_API_URL が設定されていません。");
}

const defaultParams = Object.freeze({});

const getAccessToken = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
};

const parseJson = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("searchParamsJson のパースに失敗しました", error, value);
    return {};
  }
};

const normalizeBoolean = (value) => value === true || value === "TRUE" || value === 1;

const normalizeHistory = (row) => ({
  ...row,
  favoriteFlag: normalizeBoolean(row.favoriteFlag),
  isDeleted: normalizeBoolean(row.isDeleted),
  searchParams: parseJson(row.searchParamsJson),
});

const ensureToken = () => {
  const token = getAccessToken();
  if (!token) {
    throw new Error("Googleアクセストークンが取得できませんでした。ログインし直してください。");
  }
  return token;
};

const toFormValue = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
};

const postForm = async (payload) => {
  const token = ensureToken();
  const data = new URLSearchParams();
  const merged = { ...payload, accessToken: token };
  Object.entries(merged).forEach(([key, value]) => {
    const formValue = toFormValue(value);
    if (formValue === undefined) return;
    data.append(key, formValue);
  });
  const response = await axios.post(API_URL, data, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return response?.data;
};

export const fetchSearchHistories = async ({ userId, pageKey } = defaultParams) => {
  if (!API_URL) return [];
  if (!userId) throw new Error("userId は必須です");

  const token = ensureToken();

  const response = await axios.get(API_URL, {
    params: {
      action: "getHistories",
      userId,
      pageKey: pageKey || "",
      accessToken: token,
    },
  });

  const rows = response?.data?.data || [];
  return rows.map(normalizeHistory);
};

export const addSearchHistory = async (payload = defaultParams) => {
  if (!API_URL) return null;
  if (!payload.userId) throw new Error("userId は必須です");

  const data = await postForm({
    action: "addHistory",
    ...payload,
    searchParams: payload.searchParams || undefined,
    searchParamsJson: payload.searchParamsJson || undefined,
  });

  const row = data?.data;
  return row ? normalizeHistory(row) : null;
};

export const updateSearchHistory = async (payload = defaultParams) => {
  if (!API_URL) return null;
  if (!payload.id) throw new Error("id は必須です");

  const data = await postForm({
    action: "updateHistory",
    ...payload,
    searchParams: payload.searchParams || undefined,
    searchParamsJson: payload.searchParamsJson || undefined,
  });

  const row = data?.data;
  return row ? normalizeHistory(row) : null;
};

