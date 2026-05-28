import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import NotificationBell from "@/components/NotificationBell";
import { useNotificationScheduler } from "@/hooks/useNotificationScheduler";

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
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center border-b px-2 bg-background shrink-0 no-print">
            <SidebarTrigger className="ml-1" />
            <div className="flex-1" />
            <NotificationBell />
          </header>
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AuthenticatedLayout;
