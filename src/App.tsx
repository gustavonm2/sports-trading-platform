import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Radar from './pages/Radar';
import PreLive from './pages/PreLive';
import Diary from './pages/Diary';
import Scheduler from './pages/Scheduler';
import Learning from './pages/Learning';
import Copa2026 from './pages/Copa2026';
import AlertConfig from './pages/AlertConfig';
import Login from './pages/Login';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('auth_token');
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="radar" element={<Radar />} />
          <Route path="prelive" element={<PreLive />} />
          <Route path="scheduler" element={<Scheduler />} />
          <Route path="diary" element={<Diary />} />
          <Route path="learning" element={<Learning />} />
          <Route path="copa2026" element={<Copa2026 />} />
          <Route path="alerts" element={<AlertConfig />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
