// D:\React\salesforce_sync\src\App.js

import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import HomePage from './components/HomePage';
import { GoogleOAuthProvider } from '@react-oauth/google';
import AvailabilityPage from './components/AvailabilityPage';//空車情報検索
import Loading from './components/Loading';
import GeneralAnalysisPage from './components/GeneralAnalysisPage'; // 案件分析
import SubcontractorAnalysisPage from './components/SubcontractorAnalysisPage'; // サブコントラクター分析
import Withdrawn from './components/Withdrawn';//離脱パートナー検索
import RequireAuth from './components/RequireAuth';
import { watchForAppUpdate } from './utils/appUpdate';

// ログインが必要なページ。未ログインで直接URLを開くとログイン画面へ戻す。
const PROTECTED_ROUTES = [
  { path: '/home', element: <HomePage /> },
  { path: '/availability', element: <AvailabilityPage /> },
  { path: '/withdrawn', element: <Withdrawn /> },
  { path: '/subcontractor-analysis', element: <SubcontractorAnalysisPage /> },
  { path: '/general-analysis', element: <GeneralAnalysisPage /> },
];

function App() {
  // ホーム画面に追加した状態だと index.html がキャッシュされたままになり、
  // デプロイしても古い画面が出続けるため、起動時と復帰時に確認する
  useEffect(() => watchForAppUpdate(), []);

  return (
    <GoogleOAuthProvider clientId={process.env.REACT_APP_GOOGLE_CLIENT_ID}>
      <Router>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/loading" element={<Loading />} />

          {PROTECTED_ROUTES.map(({ path, element }) => (
            <Route
              key={path}
              path={path}
              element={<RequireAuth>{element}</RequireAuth>}
            />
          ))}

          {/* 存在しないURLはログイン画面へ */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </GoogleOAuthProvider>
  );
}

export default App;
