import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes , Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Register from "./pages/Register";
import ProtectedRoute from './routes/ProtectedRoute';

import "./index.css";


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
    <Routes>
    {/* /Publicas/ */}
      <Route path="/" element={<Login />} />
      <Route path="/register" element={<Register />} />
    {/* /Privadas/ */}
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      } />

    {/* /Fallback/  */}
    <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </BrowserRouter>
  </React.StrictMode>
);