import React, { useEffect, useLayoutEffect } from 'react';
import {
  createBrowserRouter,
  RouteObject,
  useRouteError,
  isRouteErrorResponse,
  Navigate,
  Outlet,
  useParams,
} from "react-router";
import { ScrollToTop } from "./components/ScrollToTop";
import { AuthBootstrapLoadingRegistrar } from "./components/AuthBootstrapLoadingRegistrar";
import { AuthPostLoginTransitionRegistrar } from "./components/AuthPostLoginTransitionRegistrar";
import { AuthLogoutTransitionRegistrar } from "./components/AuthLogoutTransitionRegistrar";
import { LanguageChangeLoadingRegistrar } from "./components/LanguageChangeLoadingRegistrar";
import { RouteNavigationLoadingRegistrar } from "./components/RouteNavigationLoadingRegistrar";
import { useMarkAppShellReadyOptional } from "./context/AppLoadingSplashContext";
import { RouteChunkBoundary } from "./routing/RouteChunkBoundary";
import {
  routeLazy,
  routeLazyDefault,
  businessLayoutLazy,
  employeeLayoutLazy,
  authPageLazy,
  joinPageLazy,
  forgotPasswordPageLazy,
  resetPasswordPageLazy,
  activateEmployeePageLazy,
  verifyEmailPageLazy,
  checkEmailPageLazy,
  platformAdminLoginPageLazy,
  unauthorizedPageLazy,
} from './routing/routeLazy';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ApprovedBusinessGate } from './components/ApprovedBusinessGate';
import { PendingVerificationAllowedGate } from './components/PendingVerificationAllowedGate';
import { PendingVerification } from './components/PendingVerification';
import { logClientError } from './lib/clientLog';
import { useNavigationFlashProbe } from './hooks/useNavigationFlashProbe';

const LoaderDiagRuntime = import.meta.env.DEV
  ? React.lazy(() =>
      import('./components/LoaderDiagRuntime').then((m) => ({ default: m.LoaderDiagRuntime })),
    )
  : null;

/** Canonical alias: `/qr/business/:id` → existing `/qr-landing/:id` (no behavior change). */
function RedirectQrBusiness() {
  const { businessId } = useParams<{ businessId: string }>();
  if (!businessId?.trim()) return <Navigate to="/" replace />;
  return <Navigate to={`/qr-landing/${businessId}`} replace />;
}

/** Legacy team directory path → canonical `/{businessSlug}`. */
function RedirectLegacyBusinessDirectory() {
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const s = businessSlug?.trim();
  if (!s) return <Navigate to="/" replace />;
  return <Navigate to={`/${encodeURIComponent(s)}`} replace />;
}

// Error boundary: never show HTTP codes or raw error details
function ErrorBoundary() {
  const error = useRouteError();
  const markShellReady = useMarkAppShellReadyOptional();
  useLayoutEffect(() => {
    markShellReady?.();
  }, [markShellReady]);

  useEffect(() => {
    logClientError('RouteErrorBoundary', error);
  }, [error]);
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const title = is404 ? "Page not found" : "This page couldn’t load";
  const message = is404
    ? "The page you're looking for doesn't exist or may have been moved."
    : "Navigation hit an unexpected problem. Go home and try again, or refresh if you were in the middle of something.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center px-4 max-w-md">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4 text-foreground">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <a
          href="/"
          className="inline-block px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover transition-colors"
        >
          Go back home
        </a>
      </div>
    </div>
  );
}

function RootLayout() {
  const markAppShellReady = useMarkAppShellReadyOptional();
  useNavigationFlashProbe();

  useLayoutEffect(() => {
    markAppShellReady?.();
  }, [markAppShellReady]);

  return (
    <>
      {import.meta.env.DEV && LoaderDiagRuntime ? (
        <React.Suspense fallback={null}>
          <LoaderDiagRuntime />
        </React.Suspense>
      ) : null}
      <ScrollToTop />
      <RouteNavigationLoadingRegistrar>
        <AuthBootstrapLoadingRegistrar>
          <AuthLogoutTransitionRegistrar>
            <AuthPostLoginTransitionRegistrar>
              <LanguageChangeLoadingRegistrar>
                <RouteChunkBoundary variant="minimal" registrationKey="root-route">
                  <Outlet />
                </RouteChunkBoundary>
              </LanguageChangeLoadingRegistrar>
            </AuthPostLoginTransitionRegistrar>
          </AuthLogoutTransitionRegistrar>
        </AuthBootstrapLoadingRegistrar>
      </RouteNavigationLoadingRegistrar>
    </>
  );
}

const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <ErrorBoundary />,
    children: [
  {
    path: '/',
    lazy: async () => {
      const { LandingPage } = await import('./pages/LandingPage');
      return { Component: LandingPage };
    },
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/create-rule',
    element: <Navigate to="/" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/create-skill',
    element: <Navigate to="/" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/auth',
    lazy: authPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/login',
    lazy: authPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business/login',
    element: <Navigate to="/login" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/employee/login',
    lazy: authPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/awaiting-approval',
    lazy: async () => {
      const { BusinessAwaitingApprovalPage } = await import('./pages/business/BusinessAwaitingApprovalPage');
      function AwaitingApprovalRoute() {
        return (
          <ProtectedRoute allowedRoles={['business']}>
            <BusinessAwaitingApprovalPage />
          </ProtectedRoute>
        );
      }
      return { Component: AwaitingApprovalRoute };
    },
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/onboarding',
    lazy: async () => {
      const { BusinessOnboardingPage } = await import('./pages/BusinessOnboardingPage');
      function OnboardingRoute() {
        return (
          <ProtectedRoute allowedRoles={['business']}>
            <BusinessOnboardingPage />
          </ProtectedRoute>
        );
      }
      return { Component: OnboardingRoute };
    },
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/subscription/success',
    lazy: async () => {
      const { SubscriptionSuccessPage } = await import('./pages/SubscriptionSuccessPage');
      function SubscriptionSuccessRoute() {
        return (
          <ProtectedRoute allowedRoles={['business']}>
            <SubscriptionSuccessPage />
          </ProtectedRoute>
        );
      }
      return { Component: SubscriptionSuccessRoute };
    },
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/subscription/canceled',
    lazy: async () => {
      const { SubscriptionCanceledPage } = await import('./pages/SubscriptionCanceledPage');
      function SubscriptionCanceledRoute() {
        return (
          <ProtectedRoute allowedRoles={['business']}>
            <SubscriptionCanceledPage />
          </ProtectedRoute>
        );
      }
      return { Component: SubscriptionCanceledRoute };
    },
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/get-started',
    element: <Navigate to="/signup" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/join',
    lazy: joinPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/join/signup',
    lazy: authPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/join/:code',
    lazy: joinPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/signup',
    lazy: authPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/forgot-password',
    lazy: forgotPasswordPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/reset-password/:token',
    lazy: resetPasswordPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/activate',
    lazy: activateEmployeePageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/verify-email',
    lazy: checkEmailPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/check-email',
    element: <Navigate to="/verify-email" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/verify',
    lazy: verifyEmailPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/pricing',
    lazy: routeLazy(() => import('./pages/PricingPage'), 'PricingPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/unauthorized',
    lazy: unauthorizedPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/verification-pending',
    element: (
      <ProtectedRoute allowedRoles={['business']}>
        <PendingVerificationAllowedGate />
      </ProtectedRoute>
    ),
    errorElement: <ErrorBoundary />,
    children: [{ index: true, Component: PendingVerification }],
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute allowedRoles={['business']}>
        <ApprovedBusinessGate />
      </ProtectedRoute>
    ),
    errorElement: <ErrorBoundary />,
    children: [
      {
        lazy: businessLayoutLazy,
        children: [
      { index: true, lazy: routeLazy(() => import('./pages/business/BusinessDashboard'), 'BusinessDashboard') },
      { path: 'settings', lazy: routeLazy(() => import('./pages/business/BusinessSettingsPage'), 'BusinessSettingsPage') },
      { path: 'profile', element: <Navigate to="/dashboard/settings?section=business" replace /> },
      { path: 'profile-settings', element: <Navigate to="/dashboard/settings?section=general" replace /> },
      /* —— Tips module —— */
      {
        path: 'tips',
        lazy: routeLazy(() => import('./pages/business/tips/BusinessTipsLayout'), 'BusinessTipsLayout'),
        children: [
          { index: true, element: <Navigate to="/dashboard/tips/transactions" replace /> },
          { path: 'live', lazy: routeLazy(() => import('./pages/business/tips/BusinessTipsLivePage'), 'BusinessTipsLivePage') },
          { path: 'transactions', lazy: routeLazy(() => import('./pages/business/tips/BusinessTipsTransactionsPage'), 'BusinessTipsTransactionsPage') },
          { path: 'analytics', lazy: routeLazy(() => import('./pages/business/tips/BusinessTipsAnalyticsPage'), 'BusinessTipsAnalyticsPage') },
        ],
      },
      /* —— Team module —— */
      {
        path: 'team',
        lazy: routeLazy(() => import('./pages/business/team/BusinessTeamLayout'), 'BusinessTeamLayout'),
        children: [
          { index: true, element: <Navigate to="/dashboard/team/employees" replace /> },
          { path: 'employees', lazy: routeLazy(() => import('./pages/business/team/BusinessTeamEmployeesPage'), 'BusinessTeamEmployeesPage') },
          { path: 'goals', element: <Navigate to="/dashboard/team/employees" replace /> },
          { path: 'performance', lazy: routeLazy(() => import('./pages/business/team/BusinessTeamPerformancePage'), 'BusinessTeamPerformancePage') },
          { path: 'top-performers', lazy: routeLazy(() => import('./pages/business/team/BusinessTeamTopPerformersPage'), 'BusinessTeamTopPerformersPage') },
        ],
      },
      /* —— QR Studio module —— */
      {
        path: 'qr-studio',
        lazy: routeLazy(() => import('./pages/business/qr-studio/QrStudioLayout'), 'QrStudioLayout'),
        children: [
          { index: true, element: <Navigate to="/dashboard/qr-studio/employees" replace /> },
          { path: 'gallery', element: <Navigate to="/dashboard/qr-studio/employees" replace /> },
          { path: 'employees', lazy: routeLazy(() => import('./pages/business/qr-studio/QrStudioEmployeesPage'), 'QrStudioEmployeesPage') },
          { path: 'locations', lazy: routeLazy(() => import('./pages/business/qr-studio/QrStudioLocationsPage'), 'QrStudioLocationsPage') },
          { path: 'templates', lazy: routeLazy(() => import('./pages/business/qr-studio/QrStudioTemplatesPage'), 'QrStudioTemplatesPage') },
          { path: 'branding', lazy: routeLazy(() => import('./pages/business/qr-studio/QrStudioBrandingPage'), 'QrStudioBrandingPage') },
          { path: 'tables', lazy: routeLazy(() => import('./pages/business/qr-studio/QrStudioTablesPage'), 'QrStudioTablesPage') },
          { path: 'downloads', element: <Navigate to="/dashboard/qr-studio/employees" replace /> },
        ],
      },
      /* —— Customers module —— */
      {
        path: 'customers',
        lazy: routeLazy(() => import('./pages/business/customers/BusinessCustomersLayout'), 'BusinessCustomersLayout'),
        children: [
          { index: true, element: <Navigate to="/dashboard/customers/feedback" replace /> },
          { path: 'feedback', lazy: routeLazy(() => import('./pages/business/customers/BusinessCustomersFeedbackPage'), 'BusinessCustomersFeedbackPage') },
          { path: 'reviews', lazy: routeLazy(() => import('./pages/business/customers/BusinessCustomersReviewsPage'), 'BusinessCustomersReviewsPage') },
        ],
      },
      /* —— Billing module —— */
      {
        path: 'billing',
        lazy: routeLazy(() => import('./pages/business/billing/BusinessBillingLayout'), 'BusinessBillingLayout'),
        children: [
          { index: true, element: <Navigate to="/dashboard/billing/subscription" replace /> },
          { path: 'subscription', lazy: routeLazy(() => import('./pages/business/billing/BusinessBillingSubscriptionPage'), 'BusinessBillingSubscriptionPage') },
          { path: 'invoices', lazy: routeLazy(() => import('./pages/business/billing/BusinessBillingSubPages'), 'BusinessBillingInvoicesPage') },
          { path: 'payment-methods', lazy: routeLazy(() => import('./pages/business/billing/BusinessBillingSubPages'), 'BusinessBillingPaymentMethodsPage') },
          { path: 'history', lazy: routeLazy(() => import('./pages/business/billing/BusinessBillingSubPages'), 'BusinessBillingHistoryPage') },
        ],
      },
      { path: 'locations', lazy: routeLazy(() => import('./pages/business/LocationsPage'), 'LocationsPage') },
      /* Legacy redirects */
      { path: 'staff-management', element: <Navigate to="/dashboard/team/employees" replace /> },
      { path: 'qr-code-management', element: <Navigate to="/dashboard/qr-studio/employees" replace /> },
      { path: 'tables', element: <Navigate to="/dashboard/qr-studio/tables" replace /> },
      { path: 'transactions', element: <Navigate to="/dashboard/tips/transactions" replace /> },
      { path: 'customer-feedback', element: <Navigate to="/dashboard/customers/feedback" replace /> },
      { path: 'support', lazy: routeLazy(() => import('./pages/business/BusinessSupportPage'), 'BusinessSupportPage') },
      { path: 'support/:ticketId', lazy: routeLazy(() => import('./pages/shared/SupportTicketDetailPage'), 'SupportTicketDetailPage') },
      { path: 'notifications', lazy: routeLazy(() => import('./pages/shared/NotificationInboxPage'), 'NotificationInboxPage') },
      { path: 'subscriptions', element: <Navigate to="/dashboard/billing/subscription" replace /> },
      { path: 'analytics', element: <Navigate to="/dashboard/tips/analytics" replace /> },
      { path: 'products', element: <Navigate to="/dashboard" replace /> },
      { path: 'subscription-billing', element: <Navigate to="/dashboard/billing/subscription" replace /> },
      { path: 'subscription-plans', element: <Navigate to="/pricing" replace /> },
        ],
      },
    ],
  },
  {
    path: '/platform-admin/login',
    lazy: platformAdminLoginPageLazy,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/platform-admin/signup',
    element: <Navigate to="/platform-admin/login" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/platform-admin',
    lazy: async () => {
      const [, { PlatformAdminRoute }, { SuperAdminLayout }] = await Promise.all([
        import("@/styles/bundles/dashboard.css"),
        import('./components/PlatformAdminRoute'),
        import('./layouts/SuperAdminLayout'),
      ]);
      function PlatformAdminShell() {
        return (
          <PlatformAdminRoute>
            <SuperAdminLayout />
          </PlatformAdminRoute>
        );
      }
      return { Component: PlatformAdminShell };
    },
    errorElement: <ErrorBoundary />,
    children: [
      { path: 'dashboard', lazy: routeLazy(() => import('./components/AdminDashboard'), 'AdminDashboard') },
      { path: 'businesses/all', lazy: routeLazy(() => import('./pages/platform/PlatformAllBusinessesPage'), 'PlatformAllBusinessesPage') },
      { path: 'businesses/onboarding-verification', lazy: routeLazy(() => import('./pages/platform/BusinessVerificationPage'), 'BusinessOnboardingVerificationPage') },
      { path: 'businesses/kyc-verification', lazy: routeLazy(() => import('./pages/platform/BusinessVerificationPage'), 'BusinessKycVerificationPage') },
      { path: 'businesses/verification', element: <Navigate to="/platform-admin/businesses/kyc-verification" replace /> },
      { path: 'businesses/subscriptions', lazy: routeLazy(() => import('./pages/platform/PlatformBusinessSubscriptionsPage'), 'PlatformBusinessSubscriptionsPage') },
      { path: 'businesses/analytics', lazy: routeLazy(() => import('./pages/platform/PlatformBusinessAnalyticsPage'), 'PlatformBusinessAnalyticsPage') },
      { path: 'businesses/:id', lazy: routeLazy(() => import('./pages/platform/BusinessDetailPage'), 'BusinessDetailPage') },
      { path: 'businesses', element: <Navigate to="/platform-admin/businesses/onboarding-verification" replace /> },
      { path: 'revenue/transactions', lazy: routeLazy(() => import('./pages/platform/GlobalTransactionsPage'), 'GlobalTransactionsPage') },
      { path: 'revenue/failed-payments', lazy: routeLazy(() => import('./pages/platform/revenue/PlatformFailedPaymentsPage'), 'PlatformFailedPaymentsPage') },
      { path: 'revenue/successful-subscriptions', lazy: routeLazy(() => import('./pages/platform/revenue/PlatformSuccessfulSubscriptionsPage'), 'PlatformSuccessfulSubscriptionsPage') },
      { path: 'revenue/failed-subscriptions', lazy: routeLazy(() => import('./pages/platform/revenue/PlatformFailedSubscriptionsPage'), 'PlatformFailedSubscriptionsPage') },
      { path: 'revenue/refunds', lazy: routeLazy(() => import('./pages/platform/revenue/PlatformRefundsPage'), 'PlatformRefundsPage') },
      { path: 'users/management', lazy: routeLazy(() => import('./pages/platform/PlatformUserManagementPage'), 'PlatformUserManagementPage') },
      { path: 'users/staff', lazy: routeLazy(() => import('./pages/platform/users/PlatformStaffAccountsPage'), 'PlatformStaffAccountsPage') },
      { path: 'users/admins', lazy: routeLazy(() => import('./pages/platform/users/PlatformAdminsPage'), 'PlatformAdminsPage') },
      { path: 'users', element: <Navigate to="/platform-admin/users/management" replace /> },
      { path: 'communication/inbox', lazy: routeLazy(() => import('./pages/shared/NotificationInboxPage'), 'NotificationInboxPage') },
      { path: 'communication/notifications', lazy: routeLazy(() => import('./pages/platform/communication/PlatformCommunicationNotificationsPage'), 'PlatformCommunicationNotificationsPage') },
      { path: 'communication/broadcasts', lazy: routeLazy(() => import('./pages/platform/PlatformAnnouncementsPage'), 'PlatformAnnouncementsPage') },
      { path: 'reports/audit-logs', lazy: routeLazy(() => import('./pages/platform/AuditLogsPage'), 'AuditLogsPage') },
      { path: 'reports/security', lazy: routeLazy(() => import('./pages/platform/reports/PlatformSecurityReportsPage'), 'PlatformSecurityReportsPage') },
      { path: 'reports/usage', lazy: routeLazy(() => import('./pages/platform/reports/PlatformUsageReportsPage'), 'PlatformUsageReportsPage') },
      { path: 'reports/commercial', lazy: routeLazy(() => import('./pages/platform/reports/PlatformCommercialIntelligencePage'), 'PlatformCommercialIntelligencePage') },
      { path: 'system/health', lazy: routeLazy(() => import('./pages/platform/PlatformSystemHealthPage'), 'PlatformSystemHealthPage') },
      { path: 'system/settings', lazy: routeLazy(() => import('./pages/platform/PlatformSettingsPage'), 'PlatformSettingsPage') },
      { path: 'support/:ticketId', lazy: routeLazy(() => import('./pages/shared/SupportTicketDetailPage'), 'SupportTicketDetailPage') },
      { path: 'transactions', element: <Navigate to="/platform-admin/revenue/transactions" replace /> },
      { path: 'logs', element: <Navigate to="/platform-admin/reports/audit-logs" replace /> },
      { path: 'settings', element: <Navigate to="/platform-admin/system/settings" replace /> },
      { path: 'notifications', element: <Navigate to="/platform-admin/communication/inbox" replace /> },
      { path: 'announcements', element: <Navigate to="/platform-admin/communication/broadcasts" replace /> },
      { index: true, element: <Navigate to="/platform-admin/dashboard" replace /> },
    ],
  },
  {
    path: '/admin',
    element: <Navigate to="/platform-admin/dashboard" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/admin/transactions',
    element: <Navigate to="/platform-admin/revenue/transactions" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/admin/verification',
    element: <Navigate to="/platform-admin/businesses/kyc-verification" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/admin/users',
    element: <Navigate to="/platform-admin/users/management" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/admin/subscriptions',
    element: <Navigate to="/platform-admin/businesses/subscriptions" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/admin/settings',
    element: <Navigate to="/platform-admin/system/settings" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/admin/notifications',
    element: <Navigate to="/platform-admin/communication/broadcasts" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/admin/activity',
    element: <Navigate to="/platform-admin/reports/audit-logs" replace />,
    errorElement: <ErrorBoundary />,
  },
  // Legal & Company Pages
  {
    path: '/privacy',
    lazy: routeLazy(() => import('./pages/PrivacyPage'), 'PrivacyPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/terms',
    lazy: routeLazy(() => import('./pages/TermsPage'), 'TermsPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/cookies',
    lazy: routeLazy(() => import('./pages/CookiesPage'), 'CookiesPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/imprint',
    lazy: routeLazy(() => import('./pages/ImprintPage'), 'ImprintPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/about',
    lazy: routeLazy(() => import('./pages/AboutPage'), 'AboutPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/contact',
    lazy: routeLazy(() => import('./pages/ContactPage'), 'ContactPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/careers',
    lazy: routeLazy(() => import('./pages/CareersPage'), 'CareersPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/blog',
    lazy: routeLazy(() => import('./pages/BlogPage'), 'BlogPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/help',
    element: <Navigate to="/contact?intent=support" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/faq',
    lazy: routeLazy(() => import('./pages/FAQPage'), 'FAQPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/mobile-app',
    lazy: routeLazy(() => import('./pages/MobileAppPage'), 'MobileAppPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/features',
    lazy: routeLazy(() => import('./pages/FeaturesPage'), 'FeaturesPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/how-it-works',
    lazy: routeLazy(() => import('./pages/HowItWorksPage'), 'HowItWorksPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/hero-demo',
    lazy: routeLazyDefault(() => import('./pages/HeroSectionDemoPage')),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/hero-animation-demo',
    lazy: routeLazy(() => import('./pages/HeroAnimationDemoPage'), 'HeroAnimationDemoPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/saas-3d-hero',
    lazy: routeLazyDefault(() => import('./pages/SaasDashboard3DHeroPage')),
    errorElement: <ErrorBoundary />,
  },
  // Customer Flow Pages
  {
    path: '/staff/:slug',
    lazy: routeLazy(() => import('./pages/customer/StaffLandingPage'), 'StaffLandingPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/qr/business/:businessId',
    Component: RedirectQrBusiness,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/qr/employee/:employeeId',
    lazy: routeLazy(() => import('./pages/customer/EmployeeQrEntryPage'), 'EmployeeQrEntryPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/qr/location/:locationId',
    lazy: routeLazy(() => import('./pages/customer/LocationQrLandingPage'), 'LocationQrLandingPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/qr/table/:tableId',
    lazy: routeLazy(() => import('./pages/customer/TableQrLandingPage'), 'TableQrLandingPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/qr-landing/:businessId?',
    lazy: routeLazy(() => import('./pages/customer/QRLandingPage'), 'QRLandingPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/table/:qrSlug',
    lazy: routeLazy(() => import('./pages/customer/QRLandingPage'), 'QRLandingPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/select-employee',
    element: <Navigate to="/" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/tip-amount',
    lazy: routeLazy(() => import('./pages/customer/TipAmountPage'), 'TipAmountPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/payment',
    lazy: routeLazy(() => import('./pages/customer/PaymentPage'), 'PaymentPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/success',
    lazy: routeLazy(() => import('./pages/customer/SuccessPage'), 'SuccessPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/rating',
    lazy: routeLazy(() => import('./pages/customer/RatingPage'), 'RatingPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/tip-complete',
    lazy: routeLazy(() => import('./pages/customer/TipCompletionPage'), 'TipCompletionPage'),
    errorElement: <ErrorBoundary />,
  },
  // Employee Dashboard Pages (staff only) — shared shell for walkthrough ribbon
  {
    path: '/employee',
    element: (
      <ProtectedRoute allowedRoles={['employee']}>
        <Outlet />
      </ProtectedRoute>
    ),
    errorElement: <ErrorBoundary />,
    children: [
      {
        lazy: employeeLayoutLazy,
        children: [
          { index: true, element: <Navigate to="/employee/dashboard" replace /> },
          { path: 'dashboard', lazy: routeLazy(() => import('./pages/employee/EmployeeDashboard'), 'EmployeeDashboard') },
          { path: 'tip-history', lazy: routeLazy(() => import('./pages/employee/EmployeeTipHistoryPage'), 'EmployeeTipHistoryPage') },
          { path: 'notifications', element: <Navigate to="/employee/tip-history" replace /> },
          { path: 'transactions', element: <Navigate to="/employee/tip-history" replace /> },
          { path: 'inbox', lazy: routeLazy(() => import('./pages/shared/NotificationInboxPage'), 'NotificationInboxPage') },
          { path: 'tip-goals', lazy: routeLazy(() => import('./pages/employee/EmployeeTipGoalsPage'), 'EmployeeTipGoalsPage') },
          { path: 'settings', lazy: routeLazy(() => import('./pages/employee/EmployeeSettingsPage'), 'EmployeeSettingsPage') },
        ],
      },
    ],
  },
  {
    path: '/employee-dashboard',
    element: <Navigate to="/employee/dashboard" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business/dashboard',
    element: <Navigate to="/dashboard" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business/dashboard/staff-management',
    element: <Navigate to="/dashboard/team/employees" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business/dashboard/qr-code-management',
    element: <Navigate to="/dashboard/qr-studio/employees" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business/dashboard/locations',
    element: <Navigate to="/dashboard/locations" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business/dashboard/tables',
    element: <Navigate to="/dashboard/qr-studio/tables" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business/qr-management',
    element: <Navigate to="/dashboard/qr-studio/employees" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business-dashboard',
    element: <Navigate to="/dashboard" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business-dashboard/staff-management',
    element: <Navigate to="/dashboard/team/employees" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business-dashboard/qr-code-management',
    element: <Navigate to="/dashboard/qr-studio/employees" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business-dashboard/locations',
    element: <Navigate to="/dashboard/locations" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/business-dashboard/tables',
    element: <Navigate to="/dashboard/qr-studio/tables" replace />,
    errorElement: <ErrorBoundary />,
  },
  // Public business team QR (Path B) — must stay below /business/dashboard* static routes
  {
    path: '/business/:businessSlug',
    Component: RedirectLegacyBusinessDirectory,
    errorElement: <ErrorBoundary />,
  },
  // Canonical public slug routes (must stay last so static paths win over params)
  {
    path: '/:businessSlug/:employeeSlug',
    lazy: routeLazy(() => import('./pages/customer/StaffTipByPublicPathPage'), 'StaffTipByPublicPathPage'),
    errorElement: <ErrorBoundary />,
  },
  {
    path: '/:businessSlug',
    lazy: routeLazy(() => import('./pages/customer/BusinessStaffDirectoryPage'), 'BusinessStaffDirectoryPage'),
    errorElement: <ErrorBoundary />,
  },
    ],
  },
];

export const router = createBrowserRouter(routes);
