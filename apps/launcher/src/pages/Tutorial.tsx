import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';

export function Tutorial() {
  const navigate = useNavigate();

  return (
    <div className="hero-shell">
      <nav className="dashboard-nav">
        <div className="nav-brand">
          <img src="/logo.png" alt="" />
          <span>PRIMÉTOILE</span>
        </div>

        <div className="nav-tabs">
          <button className="nav-tab" onClick={() => navigate('/home')}>
            Accueil
          </button>

          <button className="nav-tab" onClick={() => navigate('/settings')}>
            <SettingsIcon size={14} /> Paramètres
          </button>

          <button className="nav-tab active">
            Tutoriel
          </button>
        </div>

        <div className="nav-right" />
      </nav>

      <div className="dashboard-body">
        <div className="dashboard-main">
          <h1 className="brand-title" style={{ fontSize: '32px' }}>
            TUTORIEL
          </h1>

          <div className="status-card hud-panel">
            <div className="status-card-label">
              Guide d'installation Primétoile
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              Le tutoriel vidéo et le guide écrit seront ajoutés prochainement.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
