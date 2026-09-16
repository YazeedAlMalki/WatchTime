import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { isDevelopmentAuthEnabled } from '@workspace/dev-auth';
import { clearDevDemoSession, getDevDemoToken } from '@/lib/dev-demo-session';

const demoEnabled = isDevelopmentAuthEnabled(
  typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production',
);

type AppAuth = {
  isLoaded: boolean;
  isSignedIn: boolean;
  isDemoSignedIn: boolean;
  activateDemo: () => void;
  clearDemo: () => Promise<void>;
};

const AuthContext = createContext<AppAuth | null>(null);

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  const clerk = useClerkAuth();
  const [demoLoaded, setDemoLoaded] = useState(!demoEnabled);
  const [isDemoSignedIn, setDemoSignedIn] = useState(false);

  useEffect(() => {
    if (!demoEnabled) return;
    let mounted = true;
    getDevDemoToken().then((token) => {
      if (mounted) {
        setDemoSignedIn(!!token);
        setDemoLoaded(true);
      }
    });
    return () => { mounted = false; };
  }, []);

  const activateDemo = useCallback(() => {
    if (demoEnabled) setDemoSignedIn(true);
  }, []);
  const clearDemo = useCallback(async () => {
    if (!demoEnabled) return;
    await clearDevDemoSession();
    setDemoSignedIn(false);
  }, []);
  const value = useMemo(() => ({
    isLoaded: clerk.isLoaded && demoLoaded,
    isSignedIn: !!clerk.isSignedIn || isDemoSignedIn,
    isDemoSignedIn,
    activateDemo,
    clearDemo,
  }), [clerk.isLoaded, clerk.isSignedIn, demoLoaded, isDemoSignedIn, activateDemo, clearDemo]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth(): AppAuth {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAppAuth must be used within AppAuthProvider');
  return value;
}