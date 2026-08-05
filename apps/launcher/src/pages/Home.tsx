import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthData } from '../types/electron';
import { Play, Settings as SettingsIcon, LogOut } from 'lucide-react';

interface HomeProps {
  auth: AuthData;
  setAuth: (auth: AuthData | null) => void;
}

const QUEUE_POLL_INTERVAL_MS = 4000;

export function Home({ auth, setAuth }: HomeProps) {
  const navigate = useNavigate();
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<string>('');
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopQueuePolling = () => {
    if (queuePollRef.current !== null) {
      clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopQueuePolling();
  }, []);

  const startQueuePolling = (gamePath: string) => {
    stopQueuePolling();
    queuePollRef.current = setInterval(async () => {
      try {
        const pollRes = await window.electronAPI.pollQueue();
        if (pollRes.status === 'queued') {
          setStatus(`Na fila (posicao: ${pollRes.position})`);
          return;
        }
        stopQueuePolling();
        if (pollRes.status === 'success') {
          setStatus('Iniciando Skyrim...');
          setIsPlaying(true);
          await window.electronAPI.launchGame(gamePath, pollRes.ticket);
          setIsPlaying(false);
          return;
        }
        setStatus(`Erro: ${pollRes.message || 'fila indisponivel'}`);
      } catch (e: any) {
        stopQueuePolling();
        setStatus(`Erro: ${e.message}`);
      }
    }, QUEUE_POLL_INTERVAL_MS);
  };

  const handleLogout = async () => {
    stopQueuePolling();
    await window.electronAPI.discordLogout();
    setAuth(null);
  };

  const handlePlay = async () => {
    setIsPlaying(true);
    setStatus('Verificando pasta do jogo...');
    try {
      const config = await window.electronAPI.getLauncherConfig();
      const gamePath = config.gamePath;
      if (!gamePath) {
        setStatus('Configure a pasta do Skyrim antes de jogar.');
        navigate('/settings');
        return;
      }

      const pathOk = await window.electronAPI.checkGamePath(gamePath);
      if (!pathOk.ok) {
        setStatus(`Pasta do jogo invalida: ${pathOk.reason}`);
        navigate('/settings');
        return;
      }

      await window.electronAPI.ensureSkyrimIni({ repairOnly: true });

      setStatus('Validando mods com o servidor...');
      const verify = await window.electronAPI.verifyMods(gamePath);
      if (!verify.success) {
        setStatus(`Mods invalidos: ${verify.error || 'verificacao falhou'}`);
        return;
      }

      if (verify.loadOrder) {
        await window.electronAPI.syncLoadorder(gamePath, verify.loadOrder);
        const analysis = await window.electronAPI.analyzePlugins(gamePath, verify.loadOrder);
        if (!analysis.ok) {
          setStatus(`Problema no load order: ${analysis.problems[0]}`);
          return;
        }
      }

      setStatus('Entrando na fila...');
      const queueRes = await window.electronAPI.joinQueue();
      if (queueRes.status === 'queued') {
        setStatus(`Na fila (posicao: ${queueRes.position})`);
        startQueuePolling(gamePath);
        return;
      }
      if (queueRes.status === 'success') {
        setStatus('Iniciando Skyrim...');
        await window.electronAPI.launchGame(gamePath, queueRes.ticket);
        return;
      }
      setStatus(`Erro: ${queueRes.message || 'fila indisponivel'}`);
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <div className="page-container" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {auth.avatar ? (
            <img src={auth.avatar} alt="Avatar" style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2px solid var(--border-color)' }} />
          ) : (
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--border-color)' }} />
          )}
          <div>
            <div style={{ fontWeight: 600, fontSize: '18px' }}>{auth.globalName}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Logado via Discord</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={() => navigate('/settings')} title="Configuracoes">
            <SettingsIcon size={20} />
          </button>
          <button className="btn-secondary" onClick={handleLogout} title="Sair">
            <LogOut size={20} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '24px' }}>
        <h1 style={{ fontSize: '48px', color: 'var(--accent-gold)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Skyrim Heavy RP</h1>

        <div style={{
          background: 'var(--bg-panel)',
          padding: '24px',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
          width: '100%',
          maxWidth: '400px',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '16px', color: 'var(--text-muted)', marginBottom: '16px', textTransform: 'uppercase' }}>Status do Servidor</h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
            <span style={{ fontSize: '20px', fontWeight: 600 }}>Online</span>
          </div>
          <p style={{ color: 'var(--text-muted)' }}>Mods validados automaticamente</p>
        </div>

        <button
          className="btn-primary"
          style={{ width: '100%', maxWidth: '400px', padding: '20px', fontSize: '24px' }}
          onClick={handlePlay}
          disabled={isPlaying}
        >
          <Play size={28} />
          {isPlaying ? 'AGUARDE' : 'JOGAR'}
        </button>

        {status && <p style={{ color: 'var(--accent-gold)', textAlign: 'center', maxWidth: '620px' }}>{status}</p>}
      </div>
    </div>
  );
}
