import React, { useState } from 'react';
import './HomePage.css';
import HeaderMenu from './HeaderMenu';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();
  const userEmail = localStorage.getItem("userEmail") || "未取得";
  const [menuOpen, setMenuOpen] = useState(false);
  const [ankenExpanded, setAnkenExpanded] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userEmail");
    navigate("/");
  };

  return (
    <div className="home-page">
      <HeaderMenu
        title="Salesforce Sync App"
        userName={userEmail.includes('@') ? userEmail.split('@')[0] : userEmail}
        onNavigateHome={() => navigate("/home")}
        onNavigateAvailability={() => navigate("/availability")}
        onNavigateWithdrawn={() => navigate("/withdrawn")}
        onNavigateAnalysis={() => navigate("/general-analysis")}
        onLogout={handleLogout}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
      />
      <div className="data-update-notice">
        Salesforceとのデータ連携は <strong>毎日8時・12時・16時・20時・24時</strong> に実行されます。<br />
        更新作業中は検索結果が正しく表示されない場合があります。<br />
        少し時間(3分～5分)をおいてから再度お試しください。
      </div>
      <div className="card-container">
        <h3 className="card-title">機能一覧</h3>
        <div className="card-grid">
          <div className="card-block">
            <div className="function-card" onClick={() => navigate('/availability')}>
              <h4 className="function-title">空車情報を検索</h4>
              <p className="function-text">パートナーの空き状況を条件で検索します。</p>
            </div>
          </div>
          <div className="card-block">
            <div className="function-card" onClick={() => navigate('/withdrawn')}>
              <h4 className="function-title">離脱パートナー情報を検索</h4>
              <p className="function-text">離脱したパートナーの情報を検索します。</p>
            </div>
          </div>
          <div className="card-block">
            <div
              className="function-card"
              onClick={() => setAnkenExpanded(!ankenExpanded)}
            >
              <h4 className="function-title">案件情報を検索</h4>
              <p className="function-text">
                配車済みの <span className="highlight">案件</span> を一覧で確認できます。
              </p>
            </div>
            {ankenExpanded && (
              <>
                <div
                  className="sub-card sub-card-hover"
                  onClick={() => navigate('/subcontractor-analysis')}
                >
                  <h5 className="sub-card-title">協力会社配車の案件分析</h5>
                  <p className="sub-card-text">協力会社別の配車傾向や予定売上/粗利を分析します。</p>
                </div>
                <div
                  className="sub-card sub-card-hover"
                  onClick={() => navigate('/general-analysis')}
                >
                  <h5 className="sub-card-title">案件を一覧表示</h5>
                  <p className="sub-card-text">稼働中の案件を確認することができます。</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
