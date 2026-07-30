import React, { useCallback, useEffect, useState } from 'react';
import './HomePage.css';
import HeaderMenu from './HeaderMenu';
import ScrollTopButton from './ScrollTopButton';
import PullToRefresh from './PullToRefresh';
import DataFreshness from './DataFreshness';
import SessionExpiredNotice from './SessionExpiredNotice';
import { fetchSheetUpdates } from '../utils/updatedAtApi';
import { isAuthError } from '../utils/sheetsApi';
import { useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();
  const [ankenExpanded, setAnkenExpanded] = useState(false);

  // 各シートがいつ時点のデータかを表示する（更新日時シートより）
  const [updates, setUpdates] = useState([]);
  const [updatesStatus, setUpdatesStatus] = useState('loading');

  const loadUpdates = useCallback(async ({ force = false } = {}) => {
    // 再取得中に「取得できません」が一瞬出ないよう、初回だけ loading にする
    setUpdatesStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const rows = await fetchSheetUpdates({ force });
      setUpdates(rows);
      setUpdatesStatus(rows.length ? 'ready' : 'empty');
    } catch (error) {
      if (isAuthError(error)) {
        setUpdatesStatus('auth');
      } else {
        console.error('更新日時の取得に失敗:', error);
        setUpdatesStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    loadUpdates();
  }, [loadUpdates]);

  return (
    <div className="home-page">
      <HeaderMenu title="Salesforce Sync App" />

      {updatesStatus === 'auth' ? (
        <SessionExpiredNotice
          message="Googleの認証が切れています。再ログインするとデータの更新状況を確認できます。"
          onRetry={() => loadUpdates({ force: true })}
        />
      ) : (
        <DataFreshness
          rows={updates}
          status={updatesStatus}
          onRetry={() => loadUpdates({ force: true })}
        />
      )}

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

      <ScrollTopButton />
      <PullToRefresh onRefresh={() => loadUpdates({ force: true })} />
    </div>
  );
}
