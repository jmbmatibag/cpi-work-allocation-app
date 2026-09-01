import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import SessionExpiredModal from "@/components/SessionExpiredModal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { EmployeesProvider } from "@/contexts/EmployeesContext";
import { JournalProvider } from "@/contexts/JournalContext";
import { AllocationsProvider } from "@/contexts/AllocationsContext";
import { ClientsConfigProvider } from "@/contexts/ClientsConfigContext";
import { AIConfigProvider } from "@/contexts/AIConfigContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import AuthenticatedLayout from "@/layouts/AuthenticatedLayout";
import MaintenanceGate from "@/components/MaintenanceGate";
import ProtectedRoute from "@/routes/ProtectedRoute";
import PublicOnlyRoute from "@/routes/PublicOnlyRoute";
import RoleHomeRedirect from "@/routes/RoleHomeRedirect";
import { appRoutes } from "@/routes/routeConfig";
import Login from "@/pages/Login";
import SetupPassword from "@/pages/SetupPassword";
import ResetPassword from "@/pages/ResetPassword";
import HelpGuides from "@/pages/HelpGuides";
import PatchNotesPage from "@/pages/PatchNotesPage";
import Maintenance from "@/pages/Maintenance";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

/**
 * Top-level routing for CPI Work Allocation.
 *
 * Structure:
 *   /login               -> PublicOnlyRoute  (authed users bounce home)
 *   /maintenance         -> public announcement page (always reachable)
 *   /, /dashboard, ...   -> ProtectedRoute   (auth required)
 *                           + domain providers
 *                           + AuthenticatedLayout shell
 *                           -> per-route RBAC guard -> page
 *   *                    -> NotFound (rendered inside the shell when
 *                                     authed, bounced to /login when not)
 *
 * MaintenanceGate wraps every route (inside BrowserRouter so it can read the
 * path, inside AuthProvider so it can read roles). When maintenance mode is
 * on it swaps the whole app for the announcement page — except for Admins
 * and the always-allowed public paths listed in the gate.
 *
 * Provider nesting:
 *   EmployeesProvider     (editable user directory — must wrap
 *                          AuthProvider since login queries it)
 *     AuthProvider        (session only, delegates directory queries)
 *       BrowserRouter
 *         ...
 *
 * Inside the authed shell:
 *   ClientsConfigProvider  (taxonomy: teams, clients, categories, rules)
 *     JournalProvider      (daily entries)
 *       AllocationsProvider (monthly records + flags)
 *         AuthenticatedLayout
 *
 * ClientsConfig is outermost inside the shell because Allocations and
 * Workspace read from it but nothing in it reads from them.
 */
const App = () => (
  <ThemeProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    storageKey="cpi-theme"
    disableTransitionOnChange
  >
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <SessionExpiredModal />
      <EmployeesProvider>
        <AuthProvider>
          <BrowserRouter>
            <MaintenanceGate>
            <Routes>
              {/* Public */}
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <Login />
                  </PublicOnlyRoute>
                }
              />

              {/*
                Password-setup is fully public — no session check, since
                the recipient of the welcome email hasn't logged in yet
                and won't have a cookie. We intentionally do NOT wrap
                this in PublicOnlyRoute: an admin who is already logged
                in might still legitimately need to redeem a link they
                forwarded to themselves during setup testing.
              */}
              <Route path="/setup-password" element={<SetupPassword />} />

              {/*
                Password-reset is fully public — the token arrives via email to
                an unauthenticated user (they may or may not have a session when
                they click the link). Same rationale as /setup-password above.
              */}
              <Route path="/reset-password" element={<ResetPassword />} />

              {/*
                Maintenance announcement. Fully public and always reachable —
                MaintenanceGate serves this same page in place of every other
                route while maintenance mode is on, and an Admin can open
                /maintenance directly to preview the copy before flipping the
                switch. Never wrapped in a guard: a signed-out visitor whose
                first request lands here has to see it.
              */}
              <Route path="/maintenance" element={<Maintenance />} />

              {/* Authenticated shell: auth guard + providers + layout */}
              <Route
                element={
                  <ProtectedRoute>
                    <ClientsConfigProvider>
                      <AIConfigProvider>
                        <JournalProvider>
                          <AllocationsProvider>
                            <NotificationsProvider>
                              <AuthenticatedLayout />
                            </NotificationsProvider>
                          </AllocationsProvider>
                        </JournalProvider>
                      </AIConfigProvider>
                    </ClientsConfigProvider>
                  </ProtectedRoute>
                }
              >
                <Route index element={<RoleHomeRedirect />} />

                {/* Help center — auth-only (no role gate) so every signed-in
                    user, Admin included, can reach the centralized guides. */}
                <Route
                  path="/help"
                  element={
                    <ProtectedRoute>
                      <HelpGuides />
                    </ProtectedRoute>
                  }
                />

                {/* Patch updates — auth-only, no role gate, same as /help.
                    Everyone who uses the app should be able to read what
                    changed in it. */}
                <Route
                  path="/whats-new"
                  element={
                    <ProtectedRoute>
                      <PatchNotesPage />
                    </ProtectedRoute>
                  }
                />

                {appRoutes.map(({ path, element: Page, roles }) => (
                  <Route
                    key={path}
                    path={path}
                    element={
                      <ProtectedRoute roles={roles}>
                        <Page />
                      </ProtectedRoute>
                    }
                  />
                ))}

                {/* 404 inside the shell so the user keeps their sidebar */}
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
            </MaintenanceGate>
          </BrowserRouter>
        </AuthProvider>
      </EmployeesProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
