import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth as useClerkAuth } from '@clerk/expo';
import { isDevelopmentAuthEnabled } from '@workspace/dev-auth';
import { clearDevDemoSession, getDevDemoToken } from '@/lib/dev-demo-session';

const demoEnabled = isDevelopmentAuthEnabled(
  typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production',
);

type AppAuth = {
  isLoaded: boolean;
  isAuthAvailable: boolean;
  isSignedIn: boolean;
  isClerkSignedIn: boolean;
  userId: string | null;
  isDemoSignedIn: boolean;
  signOut: () => Promise<void>;
  activateDemo: () => void;
  clearDemo: () => Promise<void>;
};

const AuthContext = createContext<AppAuth | null>(null);

const unavailableAuth: AppAuth = {
  isLoaded: true,
  isAuthAvailable: false,
  isSignedIn: false,
  isClerkSignedIn: false,
  userId: null,
  isDemoSignedIn: false,
  signOut: async () => {},
  activateDemo: () => {},
  clearDemo: async () => {},
};

export function AppAuthUnavailableProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthContext.Provider value={unavailableAuth}>
      {children}
    </AuthContext.Provider>
  );
}

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
  const isLoaded = clerk.isLoaded && demoLoaded;
  const value = useMemo(() => ({
    isLoaded,
    isAuthAvailable: true,
    // Never expose a signed-in state to screens until Clerk and the optional
    // development session have both finished loading.
    isSignedIn: isLoaded && (!!clerk.isSignedIn || isDemoSignedIn),
    isClerkSignedIn: isLoaded && !!clerk.isSignedIn,
    userId: !isLoaded
      ? null
      : isDemoSignedIn
        ? 'dev-demo'
        : (clerk.userId ?? null),
    isDemoSignedIn: isLoaded && isDemoSignedIn,
    signOut: clerk.signOut,
    activateDemo,
    clearDemo,
  }), [
    isLoaded,
    clerk.isSignedIn,
    clerk.userId,
    clerk.signOut,
    isDemoSignedIn,
    activateDemo,
    clearDemo,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth(): AppAuth {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAppAuth must be used within AppAuthProvider');
  return value;
}

export function showSignInUnavailableMessage() {
  Alert.alert(
    'Sign-in unavailable',
    "WatchTime couldn't start its sign-in service. Check your connection and try again.",
  );
}
