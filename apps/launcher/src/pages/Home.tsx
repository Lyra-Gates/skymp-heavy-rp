import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthData, LaunchGameResult } from '../types/electron';
import { Play, Settings as SettingsIcon, LogOut, FolderOpen, RefreshCw, BookOpen } from 'lucide-react';
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

const gamePathReason = (reason?: string) => {
  const reasons: Record<string, string> = {
    empty: 'aucun dossier sélectionné',
    'no-skyrim': 'SkyrimSE.exe est introuvable',
    gog: "la version GOG de Skyrim n'est pas prise en charge",
  };
  return reasons[reason || ''] || reason || 'raison inconnue';
};

const queueErrorMessage = (message: unknown) => {
  const messages: Record<string, string> = {
    connection_failed: 'impossible de joindre le serveur',
    invalid_response: 'réponse invalide du serveur',
    invalid_ticket: 'ticket de connexion invalide',
    not_authenticated: 'authentification requise',
    rate_limited: 'trop de tentatives, veuillez patienter',
  };
  const value = typeof message === 'string' ? message : '';
  return messages[value] || value || "file d'attente indisponible";
};

const launchFailureMessage = (result: LaunchGameResult) => {
  const detail = result.error?.trim() || result.code?.trim();
  return detail
    ? `Échec du lancement de Skyrim : ${detail}`
    : "Échec du lancement de Skyrim. Vérifiez l'installation et réessayez.";
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
  const [isolatedInstallProgress, setIsolatedInstallProgress] = useState<{
  current: number;
  total: number;
  file: string;
} | null>(null);
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

  useEffect(() => {
  window.electronAPI.onIsolatedInstallProgress((progress) => {
    setIsolatedInstallProgress(progress);

    const percent =
      progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    setStatus(`Installation de Primétoile... ${percent} %`);
  });
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
    setStatus('Session expirée. Veuillez vous reconnecter...');
    await window.electronAPI.discordLogout();
    setTimeout(() => setAuth(null), 1500);
  };

  const startQueuePolling = (gamePath: string) => {
    stopQueuePolling();
    queuePollRef.current = setInterval(async () => {
      try {
        const pollRes = await window.electronAPI.pollQueue();
        if (pollRes.status === 'queued') {
          setStatus(`Dans la file d'attente (position : ${pollRes.position})`);
          return;
        }
        stopQueuePolling();
        if (pollRes.status === 'success') {
          setStatus('Démarrage de Skyrim...');
          setIsPlaying(true);
          try {
            const launchResult = await window.electronAPI.launchGame(gamePath, pollRes.ticket);
            setStatus(launchResult.ok ? 'Skyrim est démarré.' : launchFailureMessage(launchResult));
          } finally {
            setIsPlaying(false);
          }
          return;
        }
        if (isSessionExpiredMessage(pollRes.message)) {
          await handleSessionExpired();
          return;
        }
        setStatus(`Erreur : ${queueErrorMessage(pollRes.message)}`);
      } catch (e: any) {
        stopQueuePolling();
        setStatus(`Erreur : ${e.message}`);
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
      if (client.updateAvailable) parts.push(`client ${client.version}`);
      if (mods.updateAvailable) parts.push(`mods ${mods.version}`);
      setUpdateResult(parts.length > 0 ? `Mise à jour disponible : ${parts.join(', ')}.` : 'Tout est à jour.');
    } catch (e: any) {
      setUpdateResult(`Erreur : ${e.message}`);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleInstall = async (installMode: '1.6' | '1.7') => {
    setIsPlaying(true);
    setIsolatedInstallProgress(null);
    setStatus(`Installation Primétoile pour Skyrim ${installMode}...`);

    try {
      const config = await window.electronAPI.getLauncherConfig();
      const sourceGamePath = config.sourceGamePath || config.gamePath;

      if (!sourceGamePath) {
        setStatus('Configurez le dossier de Skyrim avant de lancer l’installation.');
        navigate('/settings');
        return;
      }

      const installResult = await window.electronAPI.installIsolatedGame(installMode);

      setIsolatedInstallProgress(null);

      if (!installResult.ok) {
        if (
          installResult.reason === 'missing-source-files' &&
          installResult.missing?.length
        ) {
          setStatus(
            `Installation Skyrim source incomplète : ${installResult.missing[0]}`
          );
        } else {
          setStatus(
            `Impossible de créer l’installation Primétoile : ${
              installResult.error || installResult.reason || 'erreur inconnue'
            }`
          );
        }
        return;
      }

      const updatedConfig = await window.electronAPI.getLauncherConfig();

      if (!updatedConfig.gamePath) {
        setStatus(
          "Impossible de récupérer le dossier Primétoile après l’installation."
        );
        return;
      }

      const gamePath = updatedConfig.gamePath;

      const pathOk = await window.electronAPI.checkGamePath(gamePath);
      if (!pathOk.ok) {
        setStatus(
          `Installation Primétoile invalide : ${gamePathReason(pathOk.reason)}`
        );
        return;
      }

      setStatus('Vérification de la version du client...');
      const clientUpdate = await window.electronAPI.checkClientUpdate(gamePath);

      if (clientUpdate.error) {
        setStatus(
          `Impossible de vérifier le client : ${clientUpdate.error}`
        );
        return;
      }

      if (clientUpdate.updateAvailable) {
        setStatus(`Installation du client ${clientUpdate.version}...`);

        const clientInstall =
          await window.electronAPI.installClientUpdate(gamePath);

        if (!clientInstall.success) {
          setStatus(
            `Échec de l’installation du client : ${
              clientInstall.error || 'erreur inconnue'
            }`
          );
          return;
        }
      }

      setStatus('Vérification des mises à jour des mods...');
      const modsUpdate = await window.electronAPI.checkModsUpdate(gamePath);

      if (modsUpdate.error) {
        setStatus(
          `Impossible de vérifier les mods : ${modsUpdate.error}`
        );
        return;
      }

      if (modsUpdate.updateAvailable) {
        setStatus(`Installation des mods ${modsUpdate.version}...`);

        const modsInstall =
          await window.electronAPI.installModsUpdate(gamePath, false);

        if (!modsInstall.success) {
          setStatus(
            `Échec de l’installation des mods : ${
              modsInstall.error || 'erreur inconnue'
            }`
          );
          return;
        }
      }

      setStatus('Validation des fichiers avec le serveur...');
      const verify = await window.electronAPI.verifyMods(gamePath);

      if (!verify.success) {
        setStatus(
          `Mods invalides : ${verify.error || 'échec de la vérification'}`
        );
        return;
      }

      if (!Array.isArray(verify.loadOrder) || verify.loadOrder.length === 0) {
        setStatus(
          "Le serveur n’a fourni aucun ordre de chargement valide."
        );
        return;
      }

      setStatus("Configuration de l’ordre de chargement...");
      await window.electronAPI.syncLoadorder(gamePath, verify.loadOrder);

      const analysis =
        await window.electronAPI.analyzePlugins(gamePath, verify.loadOrder);

      if (!analysis.ok) {
        setStatus(
          `Problème dans l’ordre de chargement : ${analysis.problems[0]}`
        );
        return;
      }

      // La voix de proximité reste optionnelle et ne bloque pas l'installation.
      const voice = await window.electronAPI.ensureVoiceHelper(gamePath);
      if (!voice.ok) {
        console.warn(
          '[launcher] voice-helper n’a pas été installé :',
          voice.error
        );
      }

      setStatus(
        'Installation Primétoile terminée. Vous pouvez maintenant cliquer sur JOUER.'
      );
    } catch (e: any) {
      setStatus(`Erreur : ${e.message}`);
    } finally {
      setIsolatedInstallProgress(null);
      setIsPlaying(false);
    }
  };

  const handlePlay = async () => {
    setIsPlaying(true);
    setIsolatedInstallProgress(null);
    setStatus("Vérification de l’installation Primétoile...");

    try {
      const isolatedCheck = await window.electronAPI.checkIsolatedGame();

      if (!isolatedCheck.ok || !isolatedCheck.gamePath) {
        setStatus(
          'Primétoile n’est pas installé. Utilisez d’abord le bouton correspondant à votre version de Skyrim.'
        );
        return;
      }

      const gamePath = isolatedCheck.gamePath;

      const pathOk = await window.electronAPI.checkGamePath(gamePath);
      if (!pathOk.ok) {
        setStatus(
          `Installation Primétoile invalide : ${gamePathReason(pathOk.reason)}`
        );
        return;
      }

      // JOUER V11 ne répare et n'installe rien.
      setStatus('Validation de la version du client...');
      const clientUpdate = await window.electronAPI.checkClientUpdate(gamePath);

      if (clientUpdate.error) {
        setStatus(
          `Impossible de valider la version du client : ${clientUpdate.error}`
        );
        return;
      }

      if (clientUpdate.updateAvailable) {
        setStatus(
          `Mise à jour obligatoire du client : ${clientUpdate.version}. Relancez l’installation Primétoile.`
        );
        return;
      }

      setStatus('Préparation de la compatibilité SkyMP...');

      const esl = await window.electronAPI.normalizeEslPlugins(gamePath);

      if (!esl.ok) {
        setStatus(
          `Échec de la préparation des plugins : ${esl.error || 'erreur inconnue'}`
        );
        return;
      }

      setStatus('Validation des mods avec le serveur...');
      const verify = await window.electronAPI.verifyMods(gamePath);

      if (!verify.success) {
        setStatus(
          `Mods invalides : ${verify.error || 'échec de la vérification'}`
        );
        return;
      }

      if (!Array.isArray(verify.loadOrder) || verify.loadOrder.length === 0) {
        setStatus(
          "Le serveur n’a fourni aucun ordre de chargement valide."
        );
        return;
      }

      setStatus("Synchronisation de l’ordre de chargement...");
      await window.electronAPI.syncLoadorder(gamePath, verify.loadOrder);

      const analysis =
        await window.electronAPI.analyzePlugins(gamePath, verify.loadOrder);

      if (!analysis.ok) {
        setStatus(
          `Problème dans l’ordre de chargement : ${analysis.problems[0]}`
        );
        return;
      }

      setStatus("Entrée dans la file d’attente...");
      const queueRes = await window.electronAPI.joinQueue();

      if (queueRes.status === 'queued') {
        setStatus(
          `Dans la file d’attente (position : ${queueRes.position})`
        );
        startQueuePolling(gamePath);
        return;
      }

      if (queueRes.status === 'success') {
        setStatus('Démarrage de Skyrim...');
        const launchResult =
          await window.electronAPI.launchGame(gamePath, queueRes.ticket);

        setStatus(
          launchResult.ok
            ? 'Skyrim est démarré.'
            : launchFailureMessage(launchResult)
        );
        return;
      }

      if (isSessionExpiredMessage(queueRes.message)) {
        await handleSessionExpired();
        return;
      }

      setStatus(`Erreur : ${queueErrorMessage(queueRes.message)}`);
    } catch (e: any) {
      setStatus(`Erreur : ${e.message}`);
    } finally {
      setIsPlaying(false);
    }
  };
  const statusDotClass = serverOnline === null ? 'checking' : serverOnline ? 'online' : 'offline';
  const statusLabel = serverOnline === null ? 'Vérification' : serverOnline ? 'En ligne' : 'Hors ligne';

  return (
    <div className="hero-shell has-image" style={{ ['--hero-image' as any]: `url(${heroBg})` }}>
      <nav className="dashboard-nav">
        <div className="nav-brand">
          <img src="/logo.png" alt="" />
          <span>PRIMÉTOILE</span>
        </div>

        <div className="nav-tabs">
          <button className="nav-tab active">Accueil</button>
          <button className="nav-tab" onClick={() => navigate('/settings')}>
            <SettingsIcon size={14} /> Paramètres
          </button>

          <button className="nav-tab" onClick={() => navigate('/tutorial')}>
            <BookOpen size={14} /> Tutoriel
          </button>
        </div>

        <div className="nav-right">
          <button
            className="discord-btn"
            onClick={() =>
              window.electronAPI.openExternal('https://discord.gg/HR2JGM7wA9')
            }
          >
            DISCORD
          </button>

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
          <button className="icon-btn" onClick={handleLogout} title="Se déconnecter">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <div className="dashboard-body">
        <aside className="info-sidebar hud-panel">
          <div>
            <div className="info-section-title">Informations</div>
            <div className="info-row">
              <span className="info-row-label">Launcher</span>
              <span className="info-row-value">v{appInfo?.launcherVersion ?? '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-row-label">Client</span>
              <span className="info-row-value">{appInfo?.clientVersion ?? '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-row-label">Mods</span>
              <span className="info-row-value">{appInfo?.modsVersion ?? '—'}</span>
            </div>
          </div>

          <div>
            <div className="info-section-title">Dossier du jeu</div>
            <div className="info-path">{appInfo?.gamePath || 'Non configuré'}</div>
            <div className="maintenance-list">
              <button className="maintenance-btn" onClick={handleChangePath}>
                <FolderOpen size={14} /> Changer de dossier
              </button>
            </div>
          </div>

          <div>
            <div className="info-section-title">Maintenance</div>
            <div className="maintenance-list">
              <button className="maintenance-btn" onClick={handleCheckUpdates} disabled={checkingUpdates}>
                <RefreshCw size={14} /> {checkingUpdates ? 'Vérification...' : 'Rechercher les mises à jour'}
              </button>
              <button className="maintenance-btn" onClick={() => navigate('/settings')}>
                <SettingsIcon size={14} /> Paramètres avancés
              </button>
            </div>
            {updateResult && (
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '10px' }}>{updateResult}</p>
            )}
          </div>
        </aside>

        <div className="dashboard-main">
          <h1 className="brand-title" style={{ fontSize: '36px' }}>PRIMÉTOILE</h1>

          <div className="brand-flourish">
            <span className="brand-flourish-mark" />
          </div>

          <div className="status-card hud-panel">
            <div className="status-card-label">État du serveur</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
              <span className={`status-dot ${statusDotClass}`} style={{ width: '10px', height: '10px' }} />
              <span style={{ fontSize: '20px', fontWeight: 600 }}>{statusLabel}</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Mods vérifiés automatiquement</p>
          </div>
          <div
            style={{
              width: '100%',
              maxWidth: '500px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div
              style={{
                width: '100%',
                display: 'flex',
                gap: '10px'
              }}
            >
              <button
                className="maintenance-btn install-version-btn"
                style={{ flex: 1, padding: '14px 12px', fontSize: '14px' }}
                onClick={() => handleInstall('1.6')}
                disabled={isPlaying}
              >
                Installation pour Skyrim 1.6
              </button>

              <button
                className="maintenance-btn install-version-btn"
                style={{ flex: 1, padding: '14px 12px', fontSize: '14px' }}
                onClick={() => handleInstall('1.7')}
                disabled={isPlaying}
              >
                Installation pour Skyrim 1.7
              </button>
            </div>

            <button
              className="maintenance-btn install-version-btn"
              style={{ width: '100%', padding: '14px 12px', fontSize: '14px' }}
              onClick={() =>
                window.electronAPI.openExternal(
                  'https://www.nexusmods.com/games/skyrimspecialedition/collections/kawzcj'
                )
              }
            >
              MODS VORTEX
            </button>

            <button
              className="btn-primary"
              style={{ width: '100%', padding: '18px', fontSize: '20px' }}
              onClick={handlePlay}
              disabled={isPlaying || serverOnline === false}
            >
              <Play size={24} />
              {isPlaying ? 'VEUILLEZ PATIENTER' : 'JOUER'}
            </button>
          </div>

{isolatedInstallProgress && (
  <div
    style={{
      width: '100%',
      maxWidth: '500px',
      marginTop: '12px'
    }}
  >
    <div
      style={{
        width: '100%',
        height: '8px',
        background: 'rgba(255,255,255,0.15)',
        borderRadius: '4px',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          width: `${
            isolatedInstallProgress.total > 0
              ? (isolatedInstallProgress.current /
                  isolatedInstallProgress.total) *
                100
              : 0
          }%`,
          height: '100%',
          background: 'var(--accent-gold)',
          transition: 'width 0.2s ease'
        }}
      />
    </div>

    <p
      style={{
        color: 'var(--text-muted)',
        textAlign: 'center',
        fontSize: '12px',
        marginTop: '6px'
      }}
    >
      {Math.round(
        isolatedInstallProgress.total > 0
          ? (isolatedInstallProgress.current /
              isolatedInstallProgress.total) *
            100
          : 0
      )} %
      {' — '}
      {isolatedInstallProgress.file}
    </p>
  </div>
)}

{status && (
  <p
    style={{
      color: 'var(--accent-gold)',
      textAlign: 'center',
      maxWidth: '620px'
    }}
  >
    {status}
  </p>
)}
        </div>
      </div>
    </div>
  );
}




