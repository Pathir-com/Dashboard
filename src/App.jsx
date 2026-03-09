import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import Login from '@/pages/Login';
import Onboarding from '@/pages/Onboarding';
import { getMyPractice } from '@/lib/supabaseData';

const PaymentResult = ({ status }) => {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  const success = status === 'success';
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 max-w-md w-full text-center">
        <div className={`w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center ${success ? 'bg-green-50' : 'bg-slate-100'}`}>
          <span className="text-3xl">{success ? '\u2713' : '\u2717'}</span>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          {success ? 'Payment successful' : 'Payment cancelled'}
        </h1>
        <p className="text-slate-500 mb-4">
          {success
            ? `Thank you! Your payment has been received.${ref ? ` Reference: ${ref}` : ''}`
            : 'No payment was taken. You can close this page or try again using the link in your email.'}
        </p>
        {success && <p className="text-sm text-slate-400">You can close this page now.</p>}
      </div>
    </div>
  );
};

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { user, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

// Redirects user to their clinic if they have one, or to onboarding if they don't
const DashboardRedirect = () => {
  const { user } = useAuth();

  const { data: practice, isLoading, error } = useQuery({
    queryKey: ['my-practice', user?.id],
    queryFn: getMyPractice,
    enabled: !!user,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    console.error('Failed to load practice:', error);
  }

  if (!practice) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Navigate to={`/Clinic?id=${practice.id}`} replace />;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/payment/success" element={<PaymentResult status="success" />} />
      <Route path="/payment/cancel" element={<PaymentResult status="cancel" />} />
      <Route path="/Calculator" element={
        <LayoutWrapper currentPageName="Calculator">
          <Pages.Calculator />
        </LayoutWrapper>
      } />

      {/* Protected: onboarding */}
      <Route path="/onboarding" element={
        <ProtectedRoute>
          <Onboarding />
        </ProtectedRoute>
      } />

      {/* Protected: dashboard redirect (checks if user has a practice) */}
      <Route path="/" element={
        <ProtectedRoute>
          <DashboardRedirect />
        </ProtectedRoute>
      } />

      {/* Protected: clinic dashboard */}
      <Route path="/Clinic" element={
        <ProtectedRoute>
          <LayoutWrapper currentPageName="Clinic">
            <Pages.Clinic />
          </LayoutWrapper>
        </ProtectedRoute>
      } />

      {/* Protected: practice detail view */}
      <Route path="/Home" element={
        <ProtectedRoute>
          <LayoutWrapper currentPageName="Home">
            <Pages.Home />
          </LayoutWrapper>
        </ProtectedRoute>
      } />

      {/* Protected: admin only */}
      <Route path="/Internal" element={
        <ProtectedRoute adminOnly>
          <LayoutWrapper currentPageName="Internal">
            <Pages.Internal />
          </LayoutWrapper>
        </ProtectedRoute>
      } />

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router basename={import.meta.env.BASE_URL}>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
