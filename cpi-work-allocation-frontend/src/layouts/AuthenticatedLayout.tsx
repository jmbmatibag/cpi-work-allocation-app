import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import NotificationBell from "@/components/NotificationBell";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import DateTimeClock from "@/components/DateTimeClock";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { useNotificationScheduler } from "@/hooks/useNotificationScheduler";
import { UnsavedChangesProvider } from "@/contexts/UnsavedChangesContext";

/**
 * The shell rendered for every authenticated page: sidebar, a compact
 * header with the sidebar toggle, and an <Outlet /> for the matched
 * child route.
 *
 * Domain providers (JournalProvider, AllocationsProvider) are mounted
 * above this in App.tsx so they're available to every authed screen
 * without being re-created on navigation between pages.
 */
const AuthenticatedLayout = () => {
  useNotificationScheduler();
  return (
    <UnsavedChangesProvider>
      <SidebarProvider>
        <div className="h-screen overflow-hidden flex w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-12 flex items-center border-b px-4 bg-background shrink-0 no-print gap-3">
              <SidebarTrigger className="-ml-1" />
              <div className="flex-1" />
              {/* Only renders for an Admin while maintenance mode is on. */}
              <MaintenanceBanner />
              <DateTimeClock />
              <div className="w-px h-5 bg-border" />
              <ModeToggle />
              <div className="w-px h-5 bg-border" />
              <NotificationBell />
            </header>
            <main className="flex-1 overflow-hidden min-h-0">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </UnsavedChangesProvider>
  );
};

export default AuthenticatedLayout;
