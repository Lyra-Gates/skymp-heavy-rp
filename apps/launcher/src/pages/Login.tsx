import { useState } from 'react';
import type { AuthData } from '../types/electron';
import { LogIn } from 'lucide-react';
import heroBg from '../assets/launcher-bg.png';

interface LoginProps {
  setAuth: (auth: AuthData) => void;
}

export function Login({ setAuth }: LoginProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const authData = await window.electronAPI.discordLogin();
      if (authData) {
        setAuth(authData);
      } else {
        setError('Connexion annulée ou échouée.');
      }
    } catch (e: any) {
      setError(e.message || 'Erreur inconnue lors de la connexion.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="hero-shell has-image" style={{ ['--hero-image' as any]: `url(${heroBg})` }}>
      <div className="hero-content">
        <img src="/logo.png" alt="" style={{ width: '96px', height: '96px', objectFit: 'contain' }} />

        <div style={{ textAlign: 'center' }}>
          <h1 className="brand-title" style={{ fontSize: '34px', marginBottom: '10px' }}>Skyrim Heavy RP</h1>
          <p style={{ color: 'var(--text-muted)' }}>Authentification requise pour jouer</p>
        </div>

        <div className="brand-flourish">
          <span className="brand-flourish-mark" />
        </div>

        <button
          className="btn-primary"
          style={{ padding: '16px 36px', fontSize: '15px', marginTop: '8px' }}
          onClick={handleLogin}
          disabled={isLoggingIn}
        >
          <LogIn size={20} />
          {isLoggingIn ? 'Connexion en cours...' : 'Se connecter avec Discord'}
        </button>

        {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
      </div>
    </div>
  );
}
