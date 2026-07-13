import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bug, Download, FolderOpen, Search, Wrench } from 'lucide-react';

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
    window.electronAPI.onUpdateProgress((value) => setReport(`Cliente: ${value.phase} ${value.percent}%`));
    window.electronAPI.onModsUpdateProgress((value) => setReport(`Mods: ${value.phase} ${value.percent}%`));
  }, []);

  const resetMessages = () => {
    setError('');
    setSuccess('');
    setReport('');
  };

  const requirePath = () => {
    if (!gamePath) {
      setError('Selecione a pasta do Skyrim primeiro.');
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
        setSuccess('Pasta validada e salva com sucesso.');
      } else {
        setError(`Pasta invalida: ${valid.reason}`);
      }
    } catch (e: any) {
      setError(e.message || 'Erro ao selecionar pasta.');
    }
  };

  const handleRepairIni = async () => {
    if (!requirePath()) return;
    setBusy('repair-ini');
    const result = await window.electronAPI.ensureSkyrimIni({ mode: 'borderless' });
    setBusy('');
    if (result.ok) setSuccess(result.skipped ? 'INI ja estava valido.' : `INI reparado: ${result.width}x${result.height} ${result.mode}.`);
    else setError(result.error || 'Falha ao reparar INI.');
  };

  const handleAnalyze = async () => {
    if (!requirePath()) return;
    setBusy('analyze-mods');
    const verify = await window.electronAPI.verifyMods(gamePath);
    if (!verify.success) {
      setBusy('');
      setError(verify.error || 'Falha ao verificar mods.');
      return;
    }
    if (verify.loadOrder) await window.electronAPI.syncLoadorder(gamePath, verify.loadOrder);
    const analysis = await window.electronAPI.analyzePlugins(gamePath, verify.loadOrder || []);
    setBusy('');
    if (analysis.ok) {
      setSuccess(`Mods e load order OK. Plugins analisados: ${analysis.plugins.length}.`);
    } else {
      setError('Problemas encontrados no load order.');
      setReport(analysis.problems.slice(0, 8).join('\n'));
    }
  };

  const handleCheckUpdates = async () => {
    if (!requirePath()) return;
    setBusy('check-updates');
    const client = await window.electronAPI.checkClientUpdate(gamePath);
    const mods = await window.electronAPI.checkModsUpdate(gamePath);
    setBusy('');
    setReport([
      `Cliente: ${client.error || (client.updateAvailable ? `update ${client.installedVersion || 'nenhum'} -> ${client.version}` : `atual ${client.installedVersion || client.version || 'desconhecido'}`)}`,
      `Mods: ${mods.error || (mods.updateAvailable ? `update ${mods.installedVersion || 'nenhum'} -> ${mods.version}` : `atual ${mods.installedVersion || mods.version || 'desconhecido'}`)}`
    ].join('\n'));
  };

  const handleInstallClient = async () => {
    if (!requirePath()) return;
    if (!confirm('Atualizar cliente SkyMP agora? Feche o jogo antes de continuar.')) return;
    setBusy('client-update');
    const result = await window.electronAPI.installClientUpdate(gamePath);
    setBusy('');
    if (result.success) setSuccess(`Cliente atualizado para ${result.version}.`);
    else setError(result.error || 'Falha ao atualizar cliente.');
  };

  const handleInstallMods = async () => {
    if (!requirePath()) return;
    if (!confirm('Atualizar modpack agora? Feche o jogo antes de continuar.')) return;
    setBusy('mods-update');
    const result = await window.electronAPI.installModsUpdate(gamePath, false);
    setBusy('');
    if (result.success) setSuccess(`Mods atualizados para ${result.version}.`);
    else setError(result.error || 'Falha ao atualizar mods.');
  };

  const handleReportCrashes = async () => {
    resetMessages();
    setBusy('crash-report');
    const result = await window.electronAPI.reportRecentCrashes();
    setBusy('');
    if (result.ok) {
      setSuccess(result.sent ? `Crash report enviado (${result.sent} arquivo(s)).` : 'Nenhum crash recente encontrado.');
    } else {
      setError(result.error || 'Falha ao enviar crash report.');
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <button className="btn-secondary" onClick={() => navigate('/home')} style={{ padding: '8px' }}>
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: '24px', color: 'var(--text-main)' }}>Configuracoes</h1>
      </div>

      <div style={{ background: 'var(--bg-panel)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <h2 style={{ fontSize: '18px', color: 'var(--accent-gold)', marginBottom: '16px' }}>Diretorio do Jogo</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '16px', fontSize: '14px' }}>
          Selecione a pasta onde o Skyrim Special Edition da Steam esta instalado.
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
        <h2 style={{ fontSize: '18px', color: 'var(--accent-gold)', marginBottom: '16px' }}>Manutencao e Diagnostico</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
          <button className="btn-secondary" onClick={handleRepairIni} disabled={!!busy}>
            <Wrench size={18} /> Reparar INI
          </button>
          <button className="btn-secondary" onClick={handleAnalyze} disabled={!!busy}>
            <Search size={18} /> Analisar Mods
          </button>
          <button className="btn-secondary" onClick={handleCheckUpdates} disabled={!!busy}>
            <Download size={18} /> Checar Updates
          </button>
          <button className="btn-secondary" onClick={handleInstallClient} disabled={!!busy}>
            <Download size={18} /> Atualizar Cliente
          </button>
          <button className="btn-secondary" onClick={handleInstallMods} disabled={!!busy}>
            <Download size={18} /> Atualizar Mods
          </button>
          <button className="btn-secondary" onClick={handleReportCrashes} disabled={!!busy}>
            <Bug size={18} /> Enviar Crash
          </button>
        </div>
        {busy && <p style={{ color: 'var(--accent-gold)', marginTop: '12px' }}>Executando: {busy}</p>}
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
