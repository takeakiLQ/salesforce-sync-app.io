// D:\React\salesforce_sync\src\components\Login.js

import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useNavigate, Navigate } from 'react-router-dom';
import axios from 'axios';
import './Login.css';

const Login = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const login = useGoogleLogin({
    ux_mode: 'popup',
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.send',
    onSuccess: async (response) => {
      setLoading(true);
      try {
        const accessToken = response.access_token;
        if (!accessToken) {
          alert("アクセストークンが取得できませんでした");
          return;
        }

        localStorage.setItem("token", accessToken);

        const userInfo = await axios.get('https://people.googleapis.com/v1/people/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { personFields: 'names,emailAddresses' }
        });

        const name = userInfo.data.names?.[0]?.displayName || 'NoName';
        const email = userInfo.data.emailAddresses?.[0]?.value || 'NoEmail';

        localStorage.setItem("userName", name);
        localStorage.setItem("userEmail", email);

        await axios.post(
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
        );

  navigate('/home');
      } catch (error) {
        console.error("ログインエラー:", error.response || error.message);
        alert("ログイン処理に失敗しました。もう一度お試しください。");
        setLoading(false);
      }
    },
    onError: () => {
      alert("Googleログインに失敗しました。");
      setLoading(false);
    }
  });

  // ✅ ローディング中なら /loading に遷移
  if (loading) {
    return <Navigate to="/loading" />;
  }

  return (
    <div className="login-container">
      <h2>ログインフォーム</h2>
      
      <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="App Logo" className="login-logo" />
   
    <p>v2.1.1</p>
      <button className="google-login-button" onClick={login}>
        Googleでログイン
      </button>
      
           
    </div>
  );
};

export default Login;
