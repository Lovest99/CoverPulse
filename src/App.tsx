import React, { useState } from 'react';
import { AuthProvider, useAuth } from './client/AuthContext.tsx';
import { MarketProvider } from './client/MarketContext.tsx';
import { ToastProvider } from './client/components/Toast.tsx';
import { OfflineBanner } from './client/components/PWAControls.tsx';
import { PublicSite } from './client/components/PublicSite.tsx';
import { SignInView } from './client/components/SignInView.tsx';
import { ManagerShell } from './client/components/ManagerShell.tsx';
import { WorkerPwaView } from './client/views/WorkerPwaView.tsx';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'An unexpected rendering error occurred.' };
  }

  componentDidCatch(error: Error) {
    console.error('CoverPulse UI ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl bg-white border border-slate-200 p-7 text-center shadow-sm">
            <img
              src="/assets/aistudio/coverpulse-logo-light_442458be.svg"
              alt="CoverPulse"
              className="h-8 w-auto mx-auto"
            />
            <h1 className="mt-5 text-lg font-bold text-[#0B1F44]">Unable to display this view</h1>
            <p className="mt-2 text-sm text-[#52647D]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full min-h-[44px] rounded-lg bg-[#0B1F44] text-white text-sm font-semibold hover:bg-[#132f63] transition-colors cursor-pointer"
            >
              Reload CoverPulse
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function CoverPulseRouter() {
  const { session, loading, signInDemoPersona } = useAuth();
  const [surface, setSurface] = useState<'public' | 'signin'>('public');
  const [viewingPublic, setViewingPublic] = useState(false);
  const [launchingDemo, setLaunchingDemo] = useState(false);

  const handleQuickDemoLaunch = async (uid = 'demo-ops-manager') => {
    setViewingPublic(false);
    if (session && (!uid || session.uid === uid)) {
      return;
    }
    setLaunchingDemo(true);
    const ok = await signInDemoPersona(uid);
    setLaunchingDemo(false);
    if (!ok) {
      setSurface('signin');
    }
  };

  if (loading || launchingDemo) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6">
        <img
          src="/assets/aistudio/coverpulse-logo-light_442458be.svg"
          alt="CoverPulse"
          className="h-9 w-auto"
        />
        <div className="mt-5 w-44 h-1 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full w-1/2 bg-[#0E8BFF] rounded-full animate-pulse" />
        </div>
        <p className="mt-3 text-xs font-medium text-[#52647D]">
          {launchingDemo ? 'Initialising synthetic demo workspace...' : 'Restoring your session...'}
        </p>
      </div>
    );
  }

  if (session && !viewingPublic) {
    if (session.roleKey === 'worker') {
      return <WorkerPwaView onGoPublic={() => setViewingPublic(true)} />;
    }
    return <ManagerShell onGoPublic={() => setViewingPublic(true)} />;
  }

  if (surface === 'signin' && !session) {
    return <SignInView onBackToPublic={() => setSurface('public')} />;
  }

  return (
    <PublicSite
      onOpenSignIn={() => {
        if (session) {
          setViewingPublic(false);
        } else {
          setSurface('signin');
        }
      }}
      onQuickDemoLaunch={handleQuickDemoLaunch}
    />
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <MarketProvider>
        <ToastProvider>
          <AuthProvider>
            <OfflineBanner />
            <CoverPulseRouter />
          </AuthProvider>
        </ToastProvider>
      </MarketProvider>
    </AppErrorBoundary>
  );
}
