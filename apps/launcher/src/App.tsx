import { useState, useEffect } from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TitleBar } from './components/TitleBar';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import type { AuthData } from './types/electron';

export default function App() {
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check initial auth status
    window.electronAPI.getAuthStatus()
      .then((status) => {
        setAuth(status);
      })
      .catch((err) => {
        console.error("Impossible d’obtenir l’état de l’authentification :", err);
        setAuth(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="app-container">
        <TitleBar />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p>Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <TitleBar />
      <MemoryRouter>
        <Routes>
          <Route path="/login" element={auth ? <Navigate to="/home" /> : <Login setAuth={setAuth} />} />
          <Route path="/home" element={auth ? <Home auth={auth} setAuth={setAuth} /> : <Navigate to="/login" />} />
          <Route path="/settings" element={auth ? <Settings /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to={auth ? "/home" : "/login"} />} />
        </Routes>
      </MemoryRouter>
    </div>
  );
}
