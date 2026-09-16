import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClerkProvider, SignIn, SignUp, Show } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from 'wouter';

import { Navbar } from '@/components/layout/Navbar';
import LandingPage from '@/pages/landing';
import HomePage from '@/pages/home';
import BrowsePage from '@/pages/browse';
import TitleDetailPage from '@/pages/title-detail';
import WatchlistPage from '@/pages/watchlist';
import MyShowsPage from '@/pages/my-shows';
import StatsPage from '@/pages/stats';
import ProfilePage from '@/pages/profile';
import ImportDataPage from '@/pages/import-data';
import FeedbackPage from '@/pages/feedback';
import AdminPage from '@/pages/admin';
import { DevAuthPage } from '@/components/auth/DevAuthPage';
import { isDevelopmentAuthEnabled } from '@workspace/dev-auth';

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const isDevelopmentBuild = isDevelopmentAuthEnabled(
  import.meta.env.PROD ? "production" : "development",
);

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    // TVTime dark theme — amber primary, deep dark background
    colorPrimary: "hsl(47 92% 53%)",
    colorForeground: "hsl(0 0% 96%)",
    colorMutedForeground: "hsl(220 10% 55%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(240 15% 10%)",
    colorInput: "hsl(240 15% 16%)",
    colorInputForeground: "hsl(0 0% 96%)",
    colorNeutral: "hsl(240 15% 20%)",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[hsl(240_15%_10%)] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl border border-[hsl(240_15%_16%)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-[hsl(240_15%_8%)] !rounded-none",
    headerTitle: "text-2xl font-bold text-white font-display",
    headerSubtitle: "text-sm text-[hsl(220_10%_55%)]",
    socialButtonsBlockButtonText: "font-medium text-[hsl(0_0%_96%)]",
    formFieldLabel: "text-sm font-semibold text-[hsl(0_0%_96%)]",
    footerActionLink: "text-primary hover:text-primary/90 font-medium",
    footerActionText: "text-[hsl(220_10%_55%)]",
    dividerText: "text-[hsl(220_10%_45%)] text-xs font-medium uppercase tracking-wider",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-400 text-xs",
    alertText: "text-sm text-[hsl(0_0%_96%)] font-medium",
    logoBox: "flex justify-center mb-4",
    logoImage: "w-10 h-10 object-contain",
    socialButtonsBlockButton: "border border-[hsl(240_15%_20%)] hover:bg-[hsl(240_15%_16%)] transition-colors",
    formButtonPrimary: "bg-primary text-[hsl(240_20%_5%)] hover:bg-primary/90 shadow-sm transition-colors rounded-full font-semibold",
    formFieldInput: "border-[hsl(240_15%_20%)] bg-[hsl(240_15%_14%)] text-[hsl(0_0%_96%)] focus:border-primary focus:ring-1 focus:ring-primary rounded-lg",
    footerAction: "mt-4 text-center text-sm",
    dividerLine: "bg-[hsl(240_15%_20%)]",
    alert: "border border-[hsl(240_15%_20%)] rounded-lg p-3 bg-[hsl(240_15%_14%)]",
    otpCodeFieldInput: "border-[hsl(240_15%_20%)] bg-[hsl(240_15%_14%)] text-white focus:border-primary focus:ring-1 focus:ring-primary rounded-lg",
    formFieldRow: "mb-4 space-y-1",
    main: "p-6",
  },
};

function HomeRedirect() {
  const isDevDemo = isDevelopmentBuild &&
    window.localStorage.getItem("watchtime.devDemoActive") === "1";
  if (isDevDemo) return <Redirect to="/home" />;
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/home" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <Navbar />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        {isDevelopmentBuild ? (
          <DevAuthPage mode="sign-in" />
        ) : (
          <SignIn
            routing="path"
            path={`${basePath}/sign-in`}
            signUpUrl={`${basePath}/sign-up`}
          />
        )}
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <Navbar />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        {isDevelopmentBuild ? (
          <DevAuthPage mode="sign-up" />
        ) : (
          <SignUp
            routing="path"
            path={`${basePath}/sign-up`}
            signInUrl={`${basePath}/sign-in`}
          />
        )}
      </div>
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <div className="min-h-[100dvh] flex flex-col w-full bg-background">
      <Navbar />
      <main className="flex-1 w-full flex flex-col">
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/home" component={HomePage} />
            <Route path="/browse" component={BrowsePage} />
            <Route path="/title/:id" component={TitleDetailPage} />
            <Route path="/watchlist" component={WatchlistPage} />
            <Route path="/my-shows" component={MyShowsPage} />
            <Route path="/stats" component={StatsPage} />
            <Route path="/profile" component={ProfilePage} />
            <Route path="/import-data" component={ImportDataPage} />
            <Route path="/feedback" component={FeedbackPage} />
            <Route path="/admin" component={AdminPage} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary>
      </main>
    </div>
  );
}

function App() {
  const [, setLocation] = useLocation();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkProvider
            publishableKey={clerkPubKey}
            proxyUrl={clerkProxyUrl}
            appearance={clerkAppearance}
            signInUrl={`${basePath}/sign-in`}
            signUpUrl={`${basePath}/sign-up`}
            localization={{
              signIn: {
                start: {
                  title: "Welcome to WatchTime",
                  subtitle: "Sign in to track your shows",
                },
              },
            }}
            routerPush={(to) => setLocation(stripBase(to))}
            routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
          >
            <Switch>
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route component={Router} />
            </Switch>
          </ClerkProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
