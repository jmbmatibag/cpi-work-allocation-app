import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getDataClient } from "@/lib/dataClient";

/**
 * AI configuration for the Claude-backed parser.
 *
 * SECURITY NOTE:
 *   The API key is stored in localStorage, which is accessible to any
 *   script running on the page. This is acceptable for a single-tenant
 *   demo where the user provides their own key. For multi-tenant
 *   production deployment, move the key to a backend proxy and have
 *   this client hit your server instead of Anthropic directly.
 *
 *   We never log the key, never include it in error messages, and
 *   never send it in any request other than the Anthropic API call.
 */
export interface AIConfig {
  /** User's Anthropic API key. Empty string when not configured. */
  apiKey: string;
  /** Claude model id. Defaults to the current Haiku. */
  model: string;
  /** Master switch. When false, parser always uses rules. */
  enabled: boolean;
}

const DEFAULT_CONFIG: AIConfig = {
  apiKey: "",
  model: "claude-haiku-4-5-20251001",
  enabled: true,
};

interface AIConfigContextType {
  config: AIConfig;
  /** Update one or more fields. Persists to localStorage immediately. */
  updateConfig: (patch: Partial<AIConfig>) => void;
  /** Convenience: true when a non-empty key is set AND enabled is true. */
  isAIAvailable: boolean;
}

const AIConfigContext = createContext<AIConfigContextType | null>(null);

export const useAIConfig = () => {
  const ctx = useContext(AIConfigContext);
  if (!ctx) throw new Error("useAIConfig must be used within AIConfigProvider");
  return ctx;
};

export const AIConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<AIConfig>(() => {
    const persisted = getDataClient().read<AIConfig>("aiConfig");
    if (!persisted) return DEFAULT_CONFIG;
    return {
      apiKey: typeof persisted.apiKey === "string" ? persisted.apiKey : "",
      model: typeof persisted.model === "string" ? persisted.model : DEFAULT_CONFIG.model,
      enabled: typeof persisted.enabled === "boolean" ? persisted.enabled : true,
    };
  });

  const updateConfig = useCallback((patch: Partial<AIConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      getDataClient().write("aiConfig", next);
      return next;
    });
  }, []);

  const isAIAvailable = config.enabled && config.apiKey.trim().length > 0;

  return (
    <AIConfigContext.Provider value={{ config, updateConfig, isAIAvailable }}>
      {children}
    </AIConfigContext.Provider>
  );
};
