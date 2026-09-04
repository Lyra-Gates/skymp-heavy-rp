import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bug, Download, FolderOpen, Search, Wrench } from 'lucide-react';

const phaseLabels: Record<string, string> = {
  download: 'téléchargement',
  verify: 'vérification',
  extract: 'installation',
};
const phaseLabel = (phase: string) => phaseLabels[phase] || phase;

const busyLabels: Record<string, string> = {
  'repair-ini': 'réparation du fichier INI',
  'repair-ui': "réparation de l'interface",
  'analyze-mods': 'analyse des mods',
  'check-updates': 'recherche des mises à jour',
  'client-update': 'mise à jour du client',
  'mods-update': 'mise à jour des mods',
  'crash-report': 'envoi des rapports de plantage',
};
const busyLabel = (busy: string) => busyLabels[busy] || busy;

export function Settings() {
  const navigate = useNavigate();
  const [gamePath, setGamePath] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [busy, setBusy] = useState<string>('');
  const [report, setReport] = useState<string>('');

  useEffect(() => {
    window.electronAPI.getLauncherConfig().then((config) => {
      if (config.gamePath) setGamePath(config.gamePath);
    });
    window.electronAPI.onUpdateProgress((value) => setReport(`Client : ${phaseLabel(value.phase)} ${value.percent} %`));
    window.electronAPI.onModsUpdateProgress((value) => setReport(`Mods : ${phaseLabel(value.phase)} ${value.percent} %`));
  }, []);

  const resetMessages = () => {
    setError('');
    setSuccess('');
    setReport('');
  };

  const requirePath = () => {
    if (!gamePath) {
      setError("Sélectionnez d'abord le dossier de Skyrim.");
      return false;
    }
    resetMessages();
    return true;
  };

  const handleSelectPath = async () => {
    resetMessages();
    try {
      const selected = await window.electronAPI.selectGamePath();
      if (!selected) return;
      const valid = await window.electronAPI.saveGamePath(selected);
      if (valid.ok) {
        setGamePath(selected);
        setSuccess('Dossier validé et enregistré.');
      } else {
        const reasons: Record<string, string> = {
          empty: 'aucun dossier sélectionné',
          'no-skyrim': 'SkyrimSE.exe est introuvable',
          gog: "la version GOG de Skyrim n'est pas prise en charge",
        };
        setError(`Dossier invalide : ${reasons[valid.reason || ''] || valid.reason || 'raison inconnue'}`);
      }
    } catch (e: any) {
      setError(e.message || 'Erreur lors de la sélection du dossier.');
    }
  };

  const handleRepairIni = async () => {
    if (!requirePath()) return;
    setBusy('repair-ini');
    try {
      const result = await window.electronAPI.ensureSkyrimIni({ mode: 'borderless' });
      if (result.ok) setSuccess(result.skipped ? 'Le fichier INI était déjà valide.' : `Fichier INI réparé : ${result.width} × ${result.height}, mode ${result.mode}.`);
      else setError(result.error || 'Échec de la réparation du fichier INI.');
    } catch (e: any) {
      setError(e.message || 'Échec de la réparation du fichier INI.');
    } finally {
      setBusy('');
    }
  };

  const handleRepairUi = async () => {
    if (!requirePath()) return;
    setBusy('repair-ui');
    try {
      const result = await window.electronAPI.ensureSkympUi(gamePath);
      if (!result.ok) setError(result.error || "Échec de la réparation de l'interface.");
      else if (result.repaired.length > 0) setSuccess(`Interface réparée : ${result.repaired.length} fichier(s).`);
      else setSuccess(`Interface valide : ${result.files || 0} fichier(s).`);
    } catch (e: any) {
      setError(e.message || "Échec de la réparation de l'interface.");
    } finally {
      setBusy('');
    }
  };

  const handleAnalyze = async () => {
    if (!requirePath()) return;
    setBusy('analyze-mods');
    try {
      const verify = await window.electronAPI.verifyMods(gamePath);
      if (!verify.success) {
        setError(verify.error || 'Échec de la vérification des mods.');
        return;
      }
      if (verify.loadOrder) await window.electronAPI.syncLoadorder(gamePath, verify.loadOrder);
      const analysis = await window.electronAPI.analyzePlugins(gamePath, verify.loadOrder || []);
      if (analysis.ok) {
        setSuccess(`Mods et ordre de chargement valides. Plugins analysés : ${analysis.plugins.length}.`);
      } else {
        setError("Des problèmes ont été détectés dans l'ordre de chargement.");
        setReport(analysis.problems.slice(0, 8).join('\n'));
      }
    } catch (e: any) {
      setError(e.message || "Échec de l'analyse des mods.");
    } finally {
      setBusy('');
    }
  };

  const handleCheckUpdates = async () => {
    if (!requirePath()) return;
    setBusy('check-updates');
    try {
      const client = await window.electronAPI.checkClientUpdate(gamePath);
      const mods = await window.electronAPI.checkModsUpdate(gamePath);
      setReport([
        `Client : ${client.error || (client.updateAvailable ? `mise à jour ${client.installedVersion || 'non installé'} → ${client.version}` : `version actuelle ${client.installedVersion || client.version || 'inconnue'}`)}`,
        `Mods : ${mods.error || (mods.updateAvailable ? `mise à jour ${mods.installedVersion || 'non installés'} → ${mods.version}` : `version actuelle ${mods.installedVersion || mods.version || 'inconnue'}`)}`
      ].join('\n'));
    } catch (e: any) {
      setError(e.message || 'Échec de la recherche des mises à jour.');
    } finally {
      setBusy('');
    }
  };

  const handleInstallClient = async () => {
    if (!requirePath()) return;
    if (!confirm('Mettre à jour le client SkyMP maintenant ? Fermez le jeu avant de continuer.')) return;
    setBusy('client-update');
    try {
      const result = await window.electronAPI.installClientUpdate(gamePath);
      if (result.success) setSuccess(`Client mis à jour vers la version ${result.version}.`);
      else setError(result.error || 'Échec de la mise à jour du client.');
    } catch (e: any) {
      setError(e.message || 'Échec de la mise à jour du client.');
    } finally {
      setBusy('');
    }
  };

  const handleInstallMods = async () => {
    if (!requirePath()) return;
    if (!confirm('Mettre à jour les mods maintenant ? Fermez le jeu avant de continuer.')) return;
    setBusy('mods-update');
    try {
      const result = await window.electronAPI.installModsUpdate(gamePath, false);
      if (result.success) setSuccess(`Mods mis à jour vers la version ${result.version}.`);
      else setError(result.error || 'Échec de la mise à jour des mods.');
    } catch (e: any) {
      setError(e.message || 'Échec de la mise à jour des mods.');
    } finally {
      setBusy('');
    }
  };

  const handleReportCrashes = async () => {
    resetMessages();
    setBusy('crash-report');
    try {
      const result = await window.electronAPI.reportRecentCrashes();
      if (result.ok) {
        setSuccess(result.sent ? `Rapport de plantage envoyé (${result.sent} fichier(s)).` : 'Aucun plantage récent trouvé.');
      } else {
        setError(result.error || "Échec de l'envoi du rapport de plantage.");
      }
    } catch (e: any) {
      setError(e.message || "Échec de l'envoi du rapport de plantage.");
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <button className="btn-secondary" onClick={() => navigate('/home')} style={{ padding: '8px' }}>
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: '24px', color: 'var(--text-main)' }}>Paramètres</h1>
      </div>

      <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <h2 style={{ fontSize: '18px', color: 'var(--accent-gold)', marginBottom: '16px' }}>Dossier du jeu</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '16px', fontSize: '14px' }}>
          Sélectionnez le dossier dans lequel Skyrim Special Edition est installé via Steam.
        </p>

        <div style={{ display: 'flex', gap: '12px' }}>
          <input
            type="text"
            readOnly
            value={gamePath}
            placeholder="Ex: C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition"
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              borderRadius: '4px',
              fontFamily: 'monospace'
            }}
          />
          <button className="btn-primary" onClick={handleSelectPath} style={{ padding: '12px 16px' }}>
            <FolderOpen size={18} />
          </button>
        </div>

        {error && <p style={{ color: 'var(--error)', marginTop: '12px', fontSize: '14px' }}>{error}</p>}
        {success && <p style={{ color: 'var(--success)', marginTop: '12px', fontSize: '14px' }}>{success}</p>}
      </div>

      <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '20px' }}>
        <h2 style={{ fontSize: '18px', color: 'var(--accent-gold)', marginBottom: '16px' }}>Maintenance et diagnostic</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
          <button className="btn-secondary" onClick={handleRepairIni} disabled={!!busy}>
            <Wrench size={18} /> Réparer le fichier INI
          </button>
          <button className="btn-secondary" onClick={handleRepairUi} disabled={!!busy}>
            <Wrench size={18} /> Réparer l’interface
          </button>
          <button className="btn-secondary" onClick={handleAnalyze} disabled={!!busy}>
            <Search size={18} /> Analyser les mods
          </button>
          <button className="btn-secondary" onClick={handleCheckUpdates} disabled={!!busy}>
            <Download size={18} /> Rechercher les mises à jour
          </button>
          <button className="btn-secondary" onClick={handleInstallClient} disabled={!!busy}>
            <Download size={18} /> Mettre à jour le client
          </button>
          <button className="btn-secondary" onClick={handleInstallMods} disabled={!!busy}>
            <Download size={18} /> Mettre à jour les mods
          </button>
          <button className="btn-secondary" onClick={handleReportCrashes} disabled={!!busy}>
            <Bug size={18} /> Envoyer les rapports
          </button>
        </div>
        {busy && <p style={{ color: 'var(--accent-gold)', marginTop: '12px' }}>Opération en cours : {busyLabel(busy)}</p>}
        {report && (
          <pre style={{
            whiteSpace: 'pre-wrap',
            marginTop: '12px',
            padding: '12px',
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            color: 'var(--text-muted)',
            fontSize: '13px'
          }}>{report}</pre>
        )}
      </div>
    </div>
  );
}
