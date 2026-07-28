// D:\React\salesforce_sync\src\components\Login.js

import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Loading from './Loading';
import { clearSheetCache } from '../utils/sheetsApi';
import './Login.css';

const Login = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const login = useGoogleLogin({
    ux_mode: 'popup',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.send',
    onSuccess: async (response) => {
      setErrorMessage('');
      setLoading(true);
      try {
        const accessToken = response.access_token;
        if (!accessToken) {
          throw new Error('アクセストークンが取得できませんでした');
        }

        localStorage.setItem("token", accessToken);
        // 前セッションのシートキャッシュは破棄し、必ず取り直す
        clearSheetCache();

        const userInfo = await axios.get('https://people.googleapis.com/v1/people/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { personFields: 'names,emailAddresses' }
        });

        const name = userInfo.data.names?.[0]?.displayName || 'NoName';
        const email = userInfo.data.emailAddresses?.[0]?.value || 'NoEmail';

        localStorage.setItem("userName", name);
        localStorage.setItem("userEmail", email);

        // ログイン履歴の記録は補助処理。失敗してもログインは通す（待たない）
        axios.post(
          `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REACT_APP_SPREADSHEET_ID}/values/ログイン履歴!A1:append`,
          {
            values: [[new Date().toLocaleString(), name, email]]
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            params: {
              valueInputOption: 'USER_ENTERED'
            }
          }
        ).catch((error) => {
          console.warn("ログイン履歴の記録に失敗しました", error.response || error.message);
        });

        navigate('/home');
      } catch (error) {
        console.error("ログインエラー:", error.response || error.message);
        localStorage.removeItem("token");
        setErrorMessage('ログイン処理に失敗しました。もう一度お試しください。');
        setLoading(false);
      }
    },
    onError: () => {
      setErrorMessage('Googleログインに失敗しました。もう一度お試しください。');
      setLoading(false);
    }
  });

  // ローディングはこのコンポーネント内で描画する。
  // （/loading へ遷移させるとLoginがアンマウントされ、失敗時に復帰できなくなる）
  if (loading) {
    return <Loading />;
  }

  return (
    <div className="login-container">
      <h2>ログインフォーム</h2>
      
      <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="App Logo" className="login-logo" />
   
    <p>ver.2</p>
      <button className="google-login-button" onClick={login}>
        Googleでログイン
      </button>

      {errorMessage && (
        <p className="login-error" role="alert">{errorMessage}</p>
      )}
    </div>
  );
};

export default Login;
