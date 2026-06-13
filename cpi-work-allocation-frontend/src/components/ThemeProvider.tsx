import { useEffect, useState } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

/**
 * Theme wrapper around next-themes.
 *
 * Hydration / first-paint note (Epic 4):
 * This is a client-only Vite SPA, but next-themes still can't know the
 * persisted choice until the JS has run and read localStorage. Until the
 * component is mounted, `useTheme()` reports `undefined`, so any UI that
 * branches on the resolved theme (e.g. the Sun/Moon toggle) must wait for
 * the mounted flag — otherwise it renders the wrong state for one frame.
 * We defer rendering children until mounted so the very first paint already
 * reflects the stored theme, eliminating the light-mode flash on reload.
 *
 * The actual persistence fix lives in the props passed from App.tsx
 * (explicit `storageKey` + `defaultTheme`) and in apiClient, which now
 * preserves the theme key when it clears localStorage on session expiry.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <NextThemesProvider {...props}>
      {/* Keep the tree mounted but invisible until the client has read the
          persisted theme, so the first visible paint is already themed and
          there's no flash-of-incorrect-theme. */}
      <div style={mounted ? undefined : { visibility: "hidden" }}>
        {children}
      </div>
    </NextThemesProvider>
  );
}
