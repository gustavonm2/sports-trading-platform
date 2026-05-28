import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Radar from './pages/Radar';
import Diary from './pages/Diary';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="radar" element={<Radar />} />
          <Route path="diary" element={<Diary />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
