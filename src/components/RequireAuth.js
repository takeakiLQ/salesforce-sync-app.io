import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getToken } from "../utils/sheetsApi";

/**
 * ログイン必須ページのガード。
 * トークンが無い状態で直接URLを開くと、データが取れず空のページが
 * 表示されるだけだったため、ログイン画面へ戻す。
 *
 * トークンが「あるが失効している」場合はここでは弾かない。
 * 各ページが SessionExpiredNotice で再認証を案内する。
 */
const RequireAuth = ({ children }) => {
  const location = useLocation();

  if (!getToken()) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return children;
};

export default RequireAuth;
