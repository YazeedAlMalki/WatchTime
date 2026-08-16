import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
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
import FeedbackPage from '@/pages/feedback';
import AdminPage from '@/pages/admin';

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

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
    colorPrimary: "hsl(350 75% 45%)",
    colorForeground: "hsl(220 20% 15%)",
    colorMutedForeground: "hsl(220 10% 45%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(40 15% 90%)",
    colorInputForeground: "hsl(220 20% 15%)",
    colorNeutral: "hsl(40 15% 90%)",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-neutral-200",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold text-neutral-900 font-display",
    headerSubtitle: "text-sm text-neutral-500",
    socialButtonsBlockButtonText: "font-medium text-neutral-700",
    formFieldLabel: "text-sm font-semibold text-neutral-900",
    footerActionLink: "text-primary hover:text-primary/90 font-medium",
    footerActionText: "text-neutral-500",
    dividerText: "text-neutral-400 text-xs font-medium uppercase tracking-wider",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-600 text-xs",
    alertText: "text-sm text-neutral-900 font-medium",
    logoBox: "flex justify-center mb-4",
    logoImage: "w-10 h-10 object-contain",
    socialButtonsBlockButton: "border border-neutral-200 hover:bg-neutral-50 transition-colors",
    formButtonPrimary: "bg-primary text-white hover:bg-primary/90 shadow-sm transition-colors rounded-full",
    formFieldInput: "border-neutral-300 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg",
    footerAction: "mt-4 text-center text-sm",
    dividerLine: "bg-neutral-200",
    alert: "border border-neutral-200 rounded-lg p-3 bg-neutral-50",
    otpCodeFieldInput: "border-neutral-300 focus:border-primary focus:ring-1 focus:ring-primary rounded-lg",
    formFieldRow: "mb-4 space-y-1",
    main: "p-6",
  },
};

function HomeRedirect() {
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
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <Navbar />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
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
