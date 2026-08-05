import { X, Minus } from 'lucide-react';

export function TitleBar() {
  const handleMinimize = () => {
    window.electronAPI.windowMinimize();
  };

  const handleClose = () => {
    window.electronAPI.windowClose();
  };

  return (
    <div className="titlebar drag-region">
      <div className="titlebar-title">SKYRIM HEAVY RP</div>
      <div className="titlebar-controls no-drag">
        <button className="titlebar-btn" onClick={handleMinimize} tabIndex={-1}>
          <Minus size={16} />
        </button>
        <button className="titlebar-btn close" onClick={handleClose} tabIndex={-1}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
