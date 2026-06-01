import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    // Split vendor packages into separate long-lived chunks. Nginx serves
    // /assets/ with a 1-year immutable cache header, so chunked vendors are
    // fetched once and cached indefinitely — only app code chunks bust on deploy.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Core React runtime — tiny, changes rarely, gets its own chunk.
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router')
          ) return 'vendor-react';
          // TanStack Query — data fetching layer, changes independently.
          if (id.includes('/@tanstack/')) return 'vendor-query';
          // Recharts + d3 are intentionally NOT assigned a manual chunk.
          // Splitting them from vendor-react causes a cross-chunk
          // React.forwardRef initialization error at runtime.
          // Rollup will co-locate them with the main entry chunk where
          // React is always already initialized.
          // Radix primitives + shadcn component glue.
          if (id.includes('/@radix-ui/')) return 'vendor-ui';
          // Form validation stack.
          if (id.includes('/react-hook-form/') || id.includes('/zod/')) return 'vendor-forms';
          // Excel export (exceljs + jszip) — heavy and rarely changing.
          if (id.includes('/exceljs/') || id.includes('/jszip/')) return 'vendor-excel';
          // Date utilities.
          if (id.includes('/date-fns/') || id.includes('/react-day-picker/')) return 'vendor-date';
          // Icon set — lucide ships many SVG components; isolate it.
          if (id.includes('/lucide-react/')) return 'vendor-icons';
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));
