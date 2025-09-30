// D:\React\salesforce_sync\src\components\AvailabilityPage.js

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './AvailabilityPage.css';

const AvailabilityPage = () => {
  const [prefectures, setPrefectures] = useState([]);
  const [cities, setCities] = useState([]);
  const [allSubRegions, setAllSubRegions] = useState({});
  const [selectedPref, setSelectedPref] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const token = localStorage.getItem('token');

  useEffect(() => {
    const fetchPrefectureData = async () => {
      try {
        const res = await axios.get(
          `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REACT_APP_SPREADSHEET_ID}/values/都道府県マスタ!B2:C`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );

        const values = res.data.values || [];

        // 連想配列形式で市区町村をグループ化
        const subRegions = {};
        values.forEach(([pref, city]) => {
          if (!subRegions[pref]) {
            subRegions[pref] = [];
          }
          subRegions[pref].push(city);
        });

        const uniquePrefs = Object.keys(subRegions);

        setAllSubRegions(subRegions);
        setPrefectures(uniquePrefs);
      } catch (error) {
        console.error('都道府県マスタの取得に失敗:', error);
      }
    };

    fetchPrefectureData();
  }, [token]);

  const handlePrefChange = (e) => {
    const selected = e.target.value;
    setSelectedPref(selected);
    setSelectedCity('');
    setCities(allSubRegions[selected] || []);
  };

  const handleCityChange = (e) => {
    setSelectedCity(e.target.value);
  };

  return (
    <div className="availability-page">
      <h2>空枠情報</h2>

      <div className="card">
        <label>都道府県</label>
        <select value={selectedPref} onChange={handlePrefChange}>
          <option value="">選択してください</option>
          {prefectures.map((pref) => (
            <option key={pref} value={pref}>
              {pref}
            </option>
          ))}
        </select>

        <label>市区町村</label>
        <select value={selectedCity} onChange={handleCityChange} disabled={!selectedPref}>
          <option value="">選択してください</option>
          {cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </div>

      {selectedPref && selectedCity && (
        <div className="result">
          <p>
            選択された地域: <strong>{selectedPref} {selectedCity}</strong>
          </p>
        </div>
      )}
    </div>
  );
};

export default AvailabilityPage;
