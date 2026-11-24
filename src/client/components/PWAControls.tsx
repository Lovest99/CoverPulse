import React, { useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA.ts';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-[#06B6D4]" />
        {compact ? 'Install' : 'Install App'}
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1F44] hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-[#06B6D4]" />
          Install on iOS
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F44]/50 p-4"
          >
            <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 id="ios-install-title" className="text-base font-bold text-[#0B1F44]">
                  Install CoverPulse on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install instructions"
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-[#52647D] list-decimal list-inside">
                <li>Tap the <strong>Share</strong> icon in the Safari toolbar.</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Confirm <strong>CoverPulse</strong> to launch in standalone mode.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-[#0B1F44] py-2.5 text-sm font-semibold text-white hover:bg-[#132f63] transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="alert"
      className="bg-[#F59E0B] text-[#0B1F44] px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 no-print"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        Offline read-only mode — displaying cached data. Shift acceptance and roster changes require live server confirmation.
      </span>
    </div>
  );
};
