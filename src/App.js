// D:\React\salesforce_sync\src\App.js

import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import HomePage from './components/HomePage';
import { GoogleOAuthProvider } from '@react-oauth/google';
import AvailabilityPage from './components/AvailabilityPage';//空車情報検索
import Loading from './components/Loading';
import GeneralAnalysisPage from './components/GeneralAnalysisPage'; // 案件分析
import SubcontractorAnalysisPage from './components/SubcontractorAnalysisPage'; // サブコントラクター分析
import Withdrawn from './components/Withdrawn';//離脱パートナー検索

function App() {
  return (
    <GoogleOAuthProvider clientId={process.env.REACT_APP_GOOGLE_CLIENT_ID}>
      <Router>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/loading" element={<Loading />} />
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/general-analysis" element={<GeneralAnalysisPage />} />
          <Route path="/subcontractor-analysis" element={<SubcontractorAnalysisPage />} />
          <Route path="/withdrawn" element={<Withdrawn />} />
        </Routes>
      </Router>
    </GoogleOAuthProvider>
  );
}

export default App;
