import React from 'react';
import './GeneralAnalysisPage.css';
import HeaderMenu from './HeaderMenu';

const AnalysisPage = () => {
  return (
    <div className="anken-page">
      {/* 共通ヘッダーメニュー */}
      <HeaderMenu title="案件分析ページ" />

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
