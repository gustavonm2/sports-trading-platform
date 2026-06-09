import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Radar from './pages/Radar';
import PreLive from './pages/PreLive';
import Diary from './pages/Diary';
import Scheduler from './pages/Scheduler';
import Learning from './pages/Learning';
import Copa2026 from './pages/Copa2026';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="radar" element={<Radar />} />
          <Route path="prelive" element={<PreLive />} />
          <Route path="scheduler" element={<Scheduler />} />
          <Route path="diary" element={<Diary />} />
          <Route path="learning" element={<Learning />} />
          <Route path="copa2026" element={<Copa2026 />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
