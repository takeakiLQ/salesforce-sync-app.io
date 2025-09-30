
import axios from "axios";

const DEFAULT_SPREADSHEET_ID = process.env.REACT_APP_SPREADSHEET_ID;

export async function fetchPrefectureCityMap({
  token,
  spreadsheetId = DEFAULT_SPREADSHEET_ID,
} = {}) {
  if (!token) {
    throw new Error("TOKEN_REQUIRED");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/都道府県マスタ!B2:C`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const areaMap = {};
  const values = response.data?.values || [];
  values.forEach(([prefecture, city]) => {
    if (!prefecture) return;
    if (!areaMap[prefecture]) {
      areaMap[prefecture] = [];
    }
    if (city && !areaMap[prefecture].includes(city)) {
      areaMap[prefecture].push(city);
    }
  });

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
