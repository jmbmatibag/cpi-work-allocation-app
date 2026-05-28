import { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

/**
 * 404 page. Rendered inside the authenticated layout (with sidebar),
 * so it uses `h-full` rather than `min-h-screen` to stay within the
 * outlet. The home link uses <Link> to keep us inside the SPA —
 * <a href="/"> would blow away the app state.
 */
const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[NotFound] No route for:", location.pathname);
    }
  }, [location.pathname]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="text-center space-y-5 max-w-md">
        <p className="text-7xl font-bold text-primary/25 tabular-nums leading-none">
          404
        </p>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            No route matches{" "}
            <span className="font-mono text-foreground bg-muted/60 px-1.5 py-0.5 rounded">
              {location.pathname}
            </span>
            .
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/" className="gap-2">
            <Home className="h-4 w-4" /> Return home
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
