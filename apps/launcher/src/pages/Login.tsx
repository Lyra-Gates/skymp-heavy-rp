import { useState } from 'react';
import type { AuthData } from '../types/electron';
import { LogIn } from 'lucide-react';

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
        setError("Login cancelado ou falhou.");
      }
    } catch (e: any) {
      setError(e.message || "Erro desconhecido ao logar.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="page-container" style={{ alignItems: 'center', justifyContent: 'center', gap: '32px' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '32px', color: 'var(--accent-gold)', marginBottom: '8px', letterSpacing: '0.1em' }}>SKYRIM HEAVY RP</h1>
        <p style={{ color: 'var(--text-muted)' }}>Autenticação necessária para jogar</p>
      </div>
      
      <button 
        className="btn-primary" 
        style={{ padding: '16px 32px', fontSize: '16px' }}
        onClick={handleLogin}
        disabled={isLoggingIn}
      >
        <LogIn size={20} />
        {isLoggingIn ? "Autenticando..." : "ENTRAR COM DISCORD"}
      </button>

      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}
