import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './GeneralAnalysisPage.css';
import HeaderMenu from './HeaderMenu';

const AnalysisPage = () => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const userEmail = localStorage.getItem("userEmail") || "未取得";
  const userNameOnly = userEmail.includes('@') ? userEmail.split('@')[0] : userEmail;

/* ====== ナビ ====== */
const handleLogout = () => {
  // 認証関連だけ削除（トークンやメール）
  localStorage.removeItem("token");
  localStorage.removeItem("userEmail");
  // localStorage.clear() は使わない！
  navigate("/");
};

  return (
    <div className="anken-page">
      {/* 共通ヘッダーメニュー */}
      <HeaderMenu
        title="案件分析ページ"
        userName={userNameOnly}
        onNavigateHome={() => navigate('/home')}
        onLogout={handleLogout}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onNavigateAvailability={() => navigate('/availability')}
        onNavigateWithdrawn={() => navigate('/withdrawn')}
        onNavigateAnalysis={() => navigate('/general-analysis')}
        onNavigateAnken={() => navigate('/subcontractor-analysis')}
      />

      {/* 本文 */}
      <div className="main-content">
        <div className="under-construction">
          <p>
            このページでは、稼働中の案件データをもとに<br />
            エリア別の案件数や、時間帯別の稼働状況などを<br />
            ざっくりと把握できるような分析機能を考えています。<br />
            提供の形や見せ方はこれから検討予定です。<br />
            少しずつ作っていきますので、気長にお待ちください。
          </p>
        </div>
      </div>
    </div>
  );
};

export default AnalysisPage;
