import { fetchSheetValues } from "./sheetsApi";

const PREFECTURE_MASTER_RANGE = "都道府県マスタ!B2:C";

let areaMapCache = null;

/**
 * 都道府県マスタから { 都道府県: [市区町村, ...] } を作る。
 * シート取得は sheetsApi 側でキャッシュされるため、ページ移動では再取得しない。
 */
export async function fetchPrefectureCityMap({ force = false } = {}) {
  if (areaMapCache && !force) return areaMapCache;

  const values = await fetchSheetValues(PREFECTURE_MASTER_RANGE, { force });

  const areaMap = {};
  values.forEach(([prefecture, city]) => {
    if (!prefecture) return;
    if (!areaMap[prefecture]) {
      areaMap[prefecture] = [];
    }
    if (city && !areaMap[prefecture].includes(city)) {
      areaMap[prefecture].push(city);
    }
  });

  areaMapCache = areaMap;
  return areaMap;
}

export function buildCityCandidates(areaMap = {}, selectedPrefs = []) {
  const result = [];
  const seen = new Set();
  const targets = selectedPrefs.length ? selectedPrefs : Object.keys(areaMap);
  targets.forEach((pref) => {
    (areaMap[pref] || []).forEach((city) => {
      if (city && !seen.has(city)) {
        seen.add(city);
        result.push(city);
      }
    });
  });
  return result;
}

export function sanitizeCitySelection(areaMap = {}, selectedPrefs = [], cities = []) {
  const validSet = new Set(buildCityCandidates(areaMap, selectedPrefs));
  if (!validSet.size) {
    return [];
  }
  return (cities || []).filter((city) => validSet.has(city));
}
