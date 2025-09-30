// src/components/Loading.js
import React from 'react';
import './Loading.css';

const Loading = () => (
  <div className="loading-container">
    <div className="loading-spinner"></div>
      <h2>ログイン中です...</h2>
      <p>しばらくお待ちください。</p>
  </div>
);

export default Loading;
