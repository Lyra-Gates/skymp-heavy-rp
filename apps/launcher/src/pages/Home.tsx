import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthData, LaunchGameResult } from '../types/electron';
import { Play, Settings as SettingsIcon, LogOut, FolderOpen, RefreshCw } from 'lucide-react';
import heroBg from '../assets/launcher-bg.png';

interface HomeProps {
  auth: AuthData;
  setAuth: (auth: AuthData | null) => void;
}

type AppInfo = {
  launcherVersion: string;
  clientVersion: string | null;
  modsVersion: string | null;
  gamePath: string | null;
};

const QUEUE_POLL_INTERVAL_MS = 4000;
const SERVER_STATUS_POLL_INTERVAL_MS = 15000;

const launchFailureMessage = (result: LaunchGameResult) => {
  const detail = result.error?.trim() || result.code?.trim();
  return detail
    ? `Falha ao iniciar Skyrim: ${detail}`
    : 'Falha ao iniciar Skyrim. Verifique a instalacao e tente novamente.';
};

export function Home({ auth, setAuth }: HomeProps) {
  const navigate = useNavigate();
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<string>('');
  // null = ainda checando. Antes disto o card mostrava "Online" fixo no JSX,
  // sem nenhuma chamada por tras — bolinha verde e texto que nunca mudavam
  // mesmo com o apps/game-api fora do ar.
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState<string>('');
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAppInfo = () => {
    window.electronAPI.getAppInfo().then(setAppInfo).catch(() => {});
  };

  const stopQueuePolling = () => {
    if (queuePollRef.current !== null) {
      clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const result = await window.electronAPI.checkServerStatus();
        if (!cancelled) setServerOnline(result.online);
      } catch {
        if (!cancelled) setServerOnline(false);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, SERVER_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    return () => stopQueuePolling();
  }, []);

  useEffect(() => {
    loadAppInfo();
  }, []);

  // `invalid_ticket`/`not_authenticated` do apps/game-api significam que nem
  // a sessao de launcher (30 dias, ver migration-v25) conseguiu emitir um
  // ticket valido — a unica saida real e' logar de novo. Antes disto o
  // jogador so via "Erro: invalid_ticket" cru na tela, sem indicacao de que
  // precisava relogar.
  const isSessionExpiredMessage = (message: unknown) =>
    message === 'invalid_ticket' || message === 'not_authenticated';

  const handleSessionExpired = async () => {
    stopQueuePolling();
    setIsPlaying(false);
    setStatus('Sessao expirada. Faca login novamente...');
    await window.electronAPI.discordLogout();
    setTimeout(() => setAuth(null), 1500);
  };

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
          try {
            const launchResult = await window.electronAPI.launchGame(gamePath, pollRes.ticket);
            setStatus(launchResult.ok ? 'Skyrim iniciado.' : launchFailureMessage(launchResult));
          } finally {
            setIsPlaying(false);
          }
          return;
        }
        if (isSessionExpiredMessage(pollRes.message)) {
          await handleSessionExpired();
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

  const handleChangePath = async () => {
    const selected = await window.electronAPI.selectGamePath();
    if (!selected) return;
    const valid = await window.electronAPI.saveGamePath(selected);
    if (valid.ok) loadAppInfo();
  };

  // Mesma checagem que Configuracoes ja fazia (handleCheckUpdates) — so
  // reexposta aqui pra nao obrigar o jogador a sair da Home pra saber se ha
  // atualizacao. A instalacao em si continua so em Configuracoes.
  const handleCheckUpdates = async () => {
    if (!appInfo?.gamePath) {
      navigate('/settings');
      return;
    }
    setCheckingUpdates(true);
    setUpdateResult('');
    try {
      const client = await window.electronAPI.checkClientUpdate(appInfo.gamePath);
      const mods = await window.electronAPI.checkModsUpdate(appInfo.gamePath);
      const parts: string[] = [];
      if (client.updateAvailable) parts.push(`cliente ${client.version}`);
      if (mods.updateAvailable) parts.push(`mods ${mods.version}`);
      setUpdateResult(parts.length > 0 ? `Atualização disponível: ${parts.join(', ')}.` : 'Tudo atualizado.');
    } catch (e: any) {
      setUpdateResult(`Erro: ${e.message}`);
    } finally {
      setCheckingUpdates(false);
    }
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

      setStatus('Verificando interface do jogo...');
      const ui = await window.electronAPI.ensureSkympUi(gamePath);
      if (!ui.ok) {
        setStatus(`Falha ao instalar a interface: ${ui.error || 'bundle indisponivel'}`);
        return;
      }

      // Voz por proximidade: opcional, nunca trava o JOGAR. Se o helper nao veio
      // no pacote (skipped) ou a copia falhou, segue — a voz so nao funciona.
      const voice = await window.electronAPI.ensureVoiceHelper(gamePath);
      if (!voice.ok) {
        console.warn('[launcher] voice-helper nao instalado:', voice.error);
      }

      setStatus('Validando versao do cliente...');
      const clientUpdate = await window.electronAPI.checkClientUpdate(gamePath);
      if (clientUpdate.error) {
        setStatus(`Nao foi possivel validar a versao do cliente: ${clientUpdate.error}`);
        return;
      }
      if (clientUpdate.updateAvailable) {
        setStatus(`Atualizacao obrigatoria do cliente: ${clientUpdate.version}. Instale em Configuracoes.`);
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
        const launchResult = await window.electronAPI.launchGame(gamePath, queueRes.ticket);
        setStatus(launchResult.ok ? 'Skyrim iniciado.' : launchFailureMessage(launchResult));
        return;
      }
      if (isSessionExpiredMessage(queueRes.message)) {
        await handleSessionExpired();
        return;
      }
      setStatus(`Erro: ${queueRes.message || 'fila indisponivel'}`);
    } catch (e: any) {
      setStatus(`Erro: ${e.message}`);
    } finally {
      setIsPlaying(false);
    }
  };

  const statusDotClass = serverOnline === null ? 'checking' : serverOnline ? 'online' : 'offline';
  const statusLabel = serverOnline === null ? 'Verificando' : serverOnline ? 'Online' : 'Offline';

  return (
    <div className="hero-shell has-image" style={{ ['--hero-image' as any]: `url(${heroBg})` }}>
      <nav className="dashboard-nav">
        <div className="nav-brand">
          <img src="/logo.png" alt="" />
          <span>Skyrim Heavy RP</span>
        </div>

        <div className="nav-tabs">
          <button className="nav-tab active">Início</button>
          <button className="nav-tab" onClick={() => navigate('/settings')}>
            <SettingsIcon size={14} /> Configurações
          </button>
        </div>

        <div className="nav-right">
          <div className="status-pill">
            <span className={`status-dot ${statusDotClass}`} />
            {statusLabel}
          </div>
          <div className="identity-chip">
            {auth.avatar ? (
              <img src={auth.avatar} alt="Avatar" />
            ) : (
              <div className="identity-fallback" />
            )}
            <span>{auth.globalName}</span>
          </div>
          <button className="icon-btn" onClick={handleLogout} title="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <div className="dashboard-body">
        <aside className="info-sidebar hud-panel">
          <div>
            <div className="info-section-title">Informações</div>
            <div className="info-row">
              <span className="info-row-label">Launcher</span>
              <span className="info-row-value">v{appInfo?.launcherVersion ?? '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-row-label">Cliente</span>
              <span className="info-row-value">{appInfo?.clientVersion ?? '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-row-label">Mods</span>
              <span className="info-row-value">{appInfo?.modsVersion ?? '—'}</span>
            </div>
          </div>

          <div>
            <div className="info-section-title">Diretório do Jogo</div>
            <div className="info-path">{appInfo?.gamePath || 'Não configurado'}</div>
            <div className="maintenance-list">
              <button className="maintenance-btn" onClick={handleChangePath}>
                <FolderOpen size={14} /> Trocar Pasta
              </button>
            </div>
          </div>

          <div>
            <div className="info-section-title">Manutenção</div>
            <div className="maintenance-list">
              <button className="maintenance-btn" onClick={handleCheckUpdates} disabled={checkingUpdates}>
                <RefreshCw size={14} /> {checkingUpdates ? 'Verificando...' : 'Verificar Atualizações'}
              </button>
              <button className="maintenance-btn" onClick={() => navigate('/settings')}>
                <SettingsIcon size={14} /> Configurações Avançadas
              </button>
            </div>
            {updateResult && (
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '10px' }}>{updateResult}</p>
            )}
          </div>
        </aside>

        <div className="dashboard-main">
          <h1 className="brand-title" style={{ fontSize: '36px' }}>Skyrim Heavy RP</h1>

          <div className="brand-flourish">
            <span className="brand-flourish-mark" />
          </div>

          <div className="status-card hud-panel">
            <div className="status-card-label">Status do Servidor</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
              <span className={`status-dot ${statusDotClass}`} style={{ width: '10px', height: '10px' }} />
              <span style={{ fontSize: '20px', fontWeight: 600 }}>{statusLabel}</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Mods validados automaticamente</p>
          </div>

          <button
            className="btn-primary"
            style={{ width: '100%', maxWidth: '400px', padding: '18px', fontSize: '20px' }}
            onClick={handlePlay}
            disabled={isPlaying || serverOnline === false}
          >
            <Play size={24} />
            {isPlaying ? 'AGUARDE' : 'JOGAR'}
          </button>

          {status && <p style={{ color: 'var(--accent-gold)', textAlign: 'center', maxWidth: '620px' }}>{status}</p>}
        </div>
      </div>
    </div>
  );
}
