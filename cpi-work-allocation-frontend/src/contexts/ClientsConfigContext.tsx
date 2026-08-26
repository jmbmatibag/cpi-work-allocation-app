import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_INFERENCE_RULES,
  type InferenceRule,
} from "@/lib/promptParser";
import { getDataClient } from "@/lib/dataClient";
import {
  DEFAULT_ENHANCEMENT_TAGS,
  normalizeEnhancementTag,
} from "cpi-work-allocation-shared";
import { api, type ApiSettingsSnapshot } from "@/lib/apiClient";

/**
 * ClientsConfigContext — admin-editable configuration for the app's
 * taxonomy.
 *
 * # Phase P (this turn)
 *
 * Reshaped from a flat two-level model (category → workTypes[]) to a
 * three-level loose hierarchy:
 *
 *   MainCategory
 *     └── SubCategory (optional)
 *           └── WorkType
 *
 * Key design points from Phase P planning:
 *
 *   - **Loose hierarchy.** A main category can have sub categories
 *     (e.g. Projects → Geniisys, Quick Policy) OR attach work types
 *     directly (e.g. HR, with no sub categories). Both are valid.
 *
 *   - **Work Types are a master list.** A work type like "Meeting"
 *     lives once in the master list and declares which parents it
 *     applies to. Parents can be main category names (for main cats
 *     with no sub cats) or sub category names (for main cats with
 *     sub cats). Many-to-many via the `parents` array.
 *
 *   - **Team rename.** "Projects" → "Ancillary Solutions" as part
 *     of this phase. Shows up in seed data; runtime propagation via
 *     version bump + fresh seed (the user-chosen migration path).
 *
 * # Backward compat during the phase
 *
 * Consumers that haven't been refactored yet (Workspace, the
 * ReviewEditor in TeamHub, etc.) still read `categories: string[]`
 * and `workTypesByCategory: Record<string, string[]>`. Those are
 * preserved as **derived** read-only fields:
 *
 *   categories              = mainCategories
 *   workTypesByCategory[X]  = flat list of work types reachable
 *                              from main category X, either directly
 *                              (no sub cats) or via any sub cat
 *                              under it. Deduplicated.
 *
 * Legacy consumers see the same array shapes they always did, so
 * nothing breaks between turns. Once Phase P turns 5-7 refactor
 * each consumer to the new API, these derived fields can go.
 */

// =====================================================================
// Data model
// =====================================================================

export interface SubCategory {
  name: string;
  /** Main category this sub category belongs to. */
  parentMainCategory: string;
  /** Client names associated with this sub category (used for Projects). Many-to-many: a client can appear in multiple projects. */
  clients?: string[];
}

export interface WorkType {
  name: string;
  /**
   * Names of main categories OR sub categories this work type applies
   * to. A work type can be attached to:
   *   - a main category directly (when that main has no sub cats), OR
   *   - one or more sub categories (when the main has sub cats), OR
   *   - any mix across multiple main categories (e.g. "Meeting"
   *     applies under HR/General Work/Geniisys).
   *
   * Invariant: every string in `parents` must refer to an existing
   * main category or sub category by name. Names within the taxonomy
   * are unique across both levels (a sub category can't share a name
   * with a main category), so a single `parents: string[]` array is
   * unambiguous.
   */
  parents: string[];
}

// =====================================================================
// Context type
// =====================================================================

export interface ClientsConfigContextType {
  // --- Teams / Clients (unchanged) ----------------------------------
  teams: readonly string[];
  clients: readonly string[];
  sharedClientList: readonly string[];
  addTeam: (name: string) => void;
  removeTeam: (name: string) => void;
  /**
   * Rename a team. Updates the teams array here; the caller is
   * responsible for calling EmployeesContext.renameTeam and
   * AllocationsContext.renameTeam to propagate the rename to
   * denormalized team fields on employees and records. Those
   * contexts live in separate providers and can't be reached from
   * inside this one without creating a dependency cycle.
   */
  renameTeam: (oldName: string, newName: string) => void;
  addClient: (name: string) => void;
  removeClient: (name: string) => void;
  /**
   * Rename a client. Same caveat as renameTeam: updates the
   * clients array here only. Callers propagate via
   * AllocationsContext.renameClient (activity-level client fields)
   * and JournalContext.renameClientTag (@CLIENT tokens in entry
   * content).
   */
  renameClient: (oldName: string, newName: string) => void;

  // --- Enhancement roster -------------------------------------------
  /**
   * Tags selectable on a "Specific Enhancement" card. Server-owned in API
   * mode (the `Enhancement` table), local state in localStorage mode.
   */
  enhancements: readonly string[];
  addEnhancement: (name: string) => void;
  removeEnhancement: (name: string) => void;
  /**
   * Rename an enhancement. Unlike renameClient, callers do NOT need to
   * propagate this: in API mode the server cascades
   * AllocationActivity.enhancementTag inside the same transaction.
   */
  renameEnhancement: (oldName: string, newName: string) => void;

  // --- New taxonomy model -------------------------------------------
  mainCategories: readonly string[];
  subCategories: readonly SubCategory[];
  workTypes: readonly WorkType[];

  /**
   * Sub categories whose `parentMainCategory` is the given main.
   * Empty if the main has no sub categories (which is valid — that
   * main category attaches work types directly).
   */
  subCategoriesForMain: (mainCategory: string) => readonly SubCategory[];

  /**
   * Work types whose `parents` array includes the given name
   * (a main category with no subs, or a sub category).
   */
  workTypesForParent: (parentName: string) => readonly WorkType[];

  // Main Category CRUD
  addMainCategory: (name: string) => void;
  removeMainCategory: (name: string) => void;
  renameMainCategory: (oldName: string, newName: string) => void;

  // Sub Category CRUD
  addSubCategory: (name: string, parentMainCategory: string) => void;
  removeSubCategory: (name: string) => void;
  renameSubCategory: (oldName: string, newName: string) => void;

  // Work Type CRUD
  addWorkType: (name: string, parents: string[]) => void;
  removeWorkType: (name: string) => void;
  renameWorkType: (oldName: string, newName: string) => void;
  /** Replace the parents array for an existing work type atomically. */
  setWorkTypeParents: (name: string, parents: string[]) => void;
  /** Copy multiple work types to a target parent in one transaction. Returns all generated rules at once. */
  bulkSetWorkTypeParents: (names: string[], targetParent: string) => void;
  /** Replace the clients array for a sub category atomically. Meaningful for Projects. */
  setSubCategoryClients: (name: string, clients: string[]) => void;

  /**
   * Client roster keyed by TAXONOMY PARENT — a sub category name, or a
   * main category name when that main has no subs (a flattened project
   * such as "Geniisys").
   *
   * Exists because the parser's Scenario A/E fan-out has to answer
   * "which clients does this tag cover?" without knowing which tier the
   * tag resolved to. Keying on the parent name makes the two tiers
   * interchangeable at the call site.
   */
  clientsByParent: Readonly<Record<string, readonly string[]>>;

  /**
   * Replace the clients array for a MAIN category atomically. Meaningful
   * only for mains with no sub categories — a main that still has subs
   * carries its rosters on those subs instead.
   */
  setMainCategoryClients: (name: string, clients: string[]) => void;

  // --- Inference rules (unchanged for now; Turn 3 may reshape) ------
  inferenceRules: readonly InferenceRule[];
  updateInferenceRules: (rules: readonly InferenceRule[]) => void;

  /**
   * Auto-generated rules from the most recent setSubCategoryClients or
   * setWorkTypeParents call. AdminSettings reads this to surface the
   * inference-summary modal. Set to null after the modal is dismissed.
   */
  lastAutoGeneratedRules: Array<{
    id: number; keywords: string[]; category: string;
    subCategory: string | null; workType: string; sortOrder: number;
  }> | null;
  clearLastAutoGeneratedRules: () => void;

  // --- Backward-compat derived fields -------------------------------
  /**
   * Legacy — same shape as pre-Phase-P (just the main category
   * names). Consumers not yet refactored to the new model read this.
   */
  categories: readonly string[];
  /**
   * Legacy — flat list of work types reachable from each main
   * category, through sub cats or directly. Deduplicated.
   */
  workTypesByCategory: Readonly<Record<string, readonly string[]>>;
}

// =====================================================================
// Seed data — Phase P refresh
// =====================================================================

/**
 * Team rename: "Projects" → "Ancillary Solutions".
 * Other teams unchanged.
 */
const SEED_TEAMS: readonly string[] = [
  "IT/Platforms",
  "HR",
  "Finance",
  "Geniisys",
  "Ancillary Solutions",
  "BD/Mktg/Sales",
  "Business",
];

const SEED_CLIENTS: readonly string[] = [
  "AFPGEN", "AUII", "CPAIC", "FGEN", "MIC", "NIA",
  "PFIC", "PNBGEN", "UCPB", "CIC", "FLT", "Meridian",
];

/**
 * Main categories per user spec:
 *   General Work, Projects, HR, IT, BD/Mktg/Sales, Finance
 */
const SEED_MAIN_CATEGORIES: readonly string[] = [
  "General Work",
  "Projects",
  "HR",
  "IT",
  "Sales, Marketing & BD",
  "Finance",
];

/**
 * Sub categories per user spec: Geniisys and Quick Policy under Projects.
 * Other main categories have no sub categories in the seed (user
 * can add more through the Settings UI in Turn 2).
 */
const SEED_SUB_CATEGORIES: readonly SubCategory[] = [
  { name: "Geniisys",     parentMainCategory: "Projects", clients: ["AFPGEN", "AUII", "CPAIC"] },
  { name: "Quick Policy", parentMainCategory: "Projects", clients: ["AFPGEN", "AUII"] },
];

/**
 * Master work types list. Each declares which parents it applies to.
 *
 * Design notes:
 *   - Common work types (Meeting, Documentation) span many parents.
 *   - Sub-category-specific work types (like Implementation under
 *     Geniisys/Quick Policy) declare the sub cats as parents.
 *   - Main categories without sub cats (HR, IT, General Work, etc.)
 *     have work types that declare the main cat name as parent.
 *
 * This seed roughly mirrors the old per-category lists but stops
 * duplicating work types across categories — "Support" existed
 * under Projects, Geniisys, Quick Policy, IT separately pre-Phase-P; now
 * it's one work type with four parents.
 */
const SEED_WORK_TYPES: readonly WorkType[] = [
  // General Work (main cat, no sub cats)
  { name: "Administrative",  parents: ["General Work"] },
  { name: "Meetings",        parents: ["General Work", "HR", "Geniisys", "Quick Policy",  "IT", "Sales, Marketing & BD", "Finance"] },
  { name: "Training",        parents: ["General Work", "HR"] },
  { name: "Documentation",   parents: ["General Work", "Geniisys", "Quick Policy",  "IT"] },
  { name: "Communication",   parents: ["General Work"] },
  { name: "Research",        parents: ["General Work", "Sales, Marketing & BD"] },

  // Projects — via Geniisys, Quick Policy, and Bliss
  { name: "Implementation",      parents: ["Geniisys", "Quick Policy"] },
  { name: "Enhancement",         parents: ["Geniisys", "Quick Policy"] },
  { name: "Maintenance",         parents: ["Geniisys", "Quick Policy"] },
  { name: "Product Development", parents: ["Geniisys", "Quick Policy"] },
  { name: "Support",             parents: ["Geniisys", "Quick Policy",  "IT"] },
  { name: "Testing",             parents: ["Geniisys", "Quick Policy"] },

  // HR
  { name: "Recruitment",     parents: ["HR"] },
  { name: "Onboarding",      parents: ["HR"] },
  { name: "Policy",          parents: ["HR"] },
  { name: "Compliance",      parents: ["HR", "Finance"] },
  { name: "Engagement",      parents: ["HR"] },
  { name: "Benefits",        parents: ["HR"] },

  // IT
  { name: "Infrastructure",  parents: ["IT"] },
  { name: "Security",        parents: ["IT"] },
  { name: "DevOps",          parents: ["IT"] },
  { name: "Helpdesk",        parents: ["IT"] },
  { name: "Networking",      parents: ["IT"] },
  { name: "Monitoring",      parents: ["IT"] },

  // BD/Mktg/Sales
  { name: "Lead Generation",   parents: ["Sales, Marketing & BD"] },
  { name: "Client Relations",  parents: ["Sales, Marketing & BD"] },
  { name: "Proposals",         parents: ["Sales, Marketing & BD"] },
  { name: "Marketing Campaign", parents: ["Sales, Marketing & BD"] },
  { name: "Sales",             parents: ["Sales, Marketing & BD"] },

  // Finance
  { name: "Budgeting",       parents: ["Finance"] },
  { name: "Reporting",       parents: ["Finance"] },
  { name: "Audit",           parents: ["Finance"] },
  { name: "Forecasting",     parents: ["Finance"] },
];

/** Label used in client dropdowns when no specific client applies. */
export const FALLBACK_CLIENT = "Internal";
/** Explicit "not applicable" client label for dropdowns. */
export const NA_CLIENT = "N/A";

/**
 * Build the unified dropdown list: [N/A, Internal, ...real clients].
 *
 * Dedupes against the configured `clients` array because seed data /
 * Admin Settings may include "Internal" or "N/A" as real client rows.
 * Without dedupe, the Select trigger renders the matched label twice
 * (e.g. "InternalInternal") since two SelectItems share the value.
 *
 * Comparison is case-insensitive so "internal", "Internal", "INTERNAL"
 * all collapse to the canonical FALLBACK_CLIENT entry.
 */
function buildSharedClientList(
  clients: readonly string[],
): readonly string[] {
  const reserved = new Set([NA_CLIENT.toLowerCase(), FALLBACK_CLIENT.toLowerCase()]);
  const filtered = clients.filter((c) => !reserved.has(c.toLowerCase()));
  return [NA_CLIENT, FALLBACK_CLIENT, ...filtered] as const;
}

// =====================================================================
// Context
// =====================================================================

const ClientsConfigContext = createContext<
  ClientsConfigContextType | undefined
>(undefined);

export const useClientsConfig = () => {
  const ctx = useContext(ClientsConfigContext);
  if (!ctx) {
    throw new Error(
      "useClientsConfig must be used within ClientsConfigProvider",
    );
  }
  return ctx;
};

/**
 * Shape of the persisted ClientsConfig bundle. Phase P v2 adds
 * `mainCategories`, `subCategories`, and `workTypes` and drops the
 * old `categories` + `workTypesByCategory` fields. Old stored data
 * is discarded via version bump (STORAGE_VERSIONS.clientsConfig: 2).
 */
interface ClientsConfigBundleV3 {
  teams: readonly string[];
  clients: readonly string[];
  /** Optional — bundles written before the roster existed simply lack it. */
  enhancements?: readonly string[];
  mainCategories: readonly string[];
  subCategories: readonly SubCategory[];
  workTypes: readonly WorkType[];
  inferenceRules: readonly InferenceRule[];
}


/**
 * Merge sub-category and main-category rosters into one parent -> clients
 * map. Sub entries are written first so that if a name somehow exists at
 * both tiers, the main-category roster wins — post-flatten the main IS the
 * authoritative record for a promoted project.
 */
function buildClientsByParent(
  subCategories: readonly SubCategory[],
  mainCategoryClients: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const sub of subCategories) {
    if (sub.clients && sub.clients.length > 0) out[sub.name] = sub.clients;
  }
  for (const [name, list] of Object.entries(mainCategoryClients)) {
    if (list.length > 0) out[name] = list;
  }
  return out;
}

const LocalClientsConfigProvider = ({ children }: { children: ReactNode }) => {
  // Lazy init — load v2 bundle or seed. Version mismatch (i.e. user
  // had v1 stored) returns undefined so we fall back to SEED, which
  // is the user-chosen migration path (fresh seed for everyone).
  const persisted = getDataClient().read<ClientsConfigBundleV3>("clientsConfig");

  const [teams, setTeams] = useState<readonly string[]>(
    () => persisted?.teams ?? SEED_TEAMS,
  );
  const [clients, setClients] = useState<readonly string[]>(
    () => persisted?.clients ?? SEED_CLIENTS,
  );
  const [enhancements, setEnhancements] = useState<readonly string[]>(
    () => persisted?.enhancements ?? DEFAULT_ENHANCEMENT_TAGS,
  );
  const [mainCategories, setMainCategories] = useState<readonly string[]>(
    () => persisted?.mainCategories ?? SEED_MAIN_CATEGORIES,
  );
  const [subCategories, setSubCategories] = useState<readonly SubCategory[]>(
    () => persisted?.subCategories ?? SEED_SUB_CATEGORIES,
  );
  const [workTypes, setWorkTypes] = useState<readonly WorkType[]>(
    () => persisted?.workTypes ?? SEED_WORK_TYPES,
  );
  const [inferenceRules, setInferenceRules] = useState<readonly InferenceRule[]>(
    () => persisted?.inferenceRules ?? DEFAULT_INFERENCE_RULES,
  );

  // Persist on any change.
  useEffect(() => {
    getDataClient().write<ClientsConfigBundleV3>("clientsConfig", {
      teams,
      clients,
      enhancements,
      mainCategories,
      subCategories,
      workTypes,
      inferenceRules,
    });
  }, [teams, clients, enhancements, mainCategories, subCategories, workTypes, inferenceRules]);

  const sharedClientList = useMemo(
    () => buildSharedClientList(clients),
    [clients],
  );

  // ------------------- Teams / Clients (unchanged) -------------------

  const addTeam = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setTeams((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }, []);

  const removeTeam = useCallback((name: string) => {
    setTeams((prev) => prev.filter((t) => t !== name));
  }, []);

  const renameTeam = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setTeams((prev) =>
      prev.map((t) => (t === oldName ? trimmed : t)),
    );
  }, []);

  const addClient = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setClients((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }, []);

  const removeClient = useCallback((name: string) => {
    setClients((prev) => prev.filter((c) => c !== name));
  }, []);

  const renameClient = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setClients((prev) =>
      prev.map((c) => (c === oldName ? trimmed : c)),
    );
  }, []);

  // ── Enhancements ────────────────────────────────────────────────────

  const addEnhancement = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setEnhancements((prev) =>
      prev.some((e) => normalizeEnhancementTag(e) === normalizeEnhancementTag(trimmed))
        ? prev
        : [...prev, trimmed],
    );
  }, []);

  const removeEnhancement = useCallback((name: string) => {
    setEnhancements((prev) => prev.filter((e) => e !== name));
  }, []);

  const renameEnhancement = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setEnhancements((prev) => prev.map((e) => (e === oldName ? trimmed : e)));
  }, []);

  // ------------------- Queries --------------------------------------

  const subCategoriesForMain = useCallback(
    (main: string) =>
      subCategories.filter((s) => s.parentMainCategory === main),
    [subCategories],
  );

  const workTypesForParent = useCallback(
    (parentName: string) =>
      workTypes.filter((w) => w.parents.includes(parentName)),
    [workTypes],
  );

  // ------------------- Main Category CRUD ---------------------------

  const addMainCategory = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMainCategories((prev) =>
      prev.includes(trimmed) ? prev : [...prev, trimmed],
    );
  }, []);

  const removeMainCategory = useCallback((name: string) => {
    // Also remove all sub categories whose parent is this main, and
    // remove this main's name from any work types' `parents` list.
    setMainCategories((prev) => prev.filter((m) => m !== name));
    setSubCategories((prev) => prev.filter((s) => s.parentMainCategory !== name));
    setWorkTypes((prev) =>
      prev.map((w) => ({
        ...w,
        parents: w.parents.filter((p) => p !== name),
      })),
    );
  }, []);

  const renameMainCategory = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      setMainCategories((prev) =>
        prev.map((m) => (m === oldName ? trimmed : m)),
      );
      setSubCategories((prev) =>
        prev.map((s) =>
          s.parentMainCategory === oldName
            ? { ...s, parentMainCategory: trimmed }
            : s,
        ),
      );
      setWorkTypes((prev) =>
        prev.map((w) => ({
          ...w,
          parents: w.parents.map((p) => (p === oldName ? trimmed : p)),
        })),
      );
    },
    [],
  );

  // ------------------- Sub Category CRUD ----------------------------

  const addSubCategory = useCallback(
    (name: string, parentMainCategory: string) => {
      const trimmed = name.trim();
      if (!trimmed || !parentMainCategory) return;
      setSubCategories((prev) =>
        prev.some((s) => s.name === trimmed)
          ? prev
          : [...prev, { name: trimmed, parentMainCategory }],
      );
    },
    [],
  );

  const removeSubCategory = useCallback((name: string) => {
    setSubCategories((prev) => prev.filter((s) => s.name !== name));
    // Strip this sub cat from any work types' parents.
    setWorkTypes((prev) =>
      prev.map((w) => ({
        ...w,
        parents: w.parents.filter((p) => p !== name),
      })),
    );
  }, []);

  const renameSubCategory = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      setSubCategories((prev) =>
        prev.map((s) => (s.name === oldName ? { ...s, name: trimmed } : s)),
      );
      setWorkTypes((prev) =>
        prev.map((w) => ({
          ...w,
          parents: w.parents.map((p) => (p === oldName ? trimmed : p)),
        })),
      );
    },
    [],
  );

  // ------------------- Work Type CRUD -------------------------------

  const addWorkType = useCallback((name: string, parents: string[]) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWorkTypes((prev) =>
      prev.some((w) => w.name === trimmed)
        ? prev
        : [...prev, { name: trimmed, parents }],
    );
  }, []);

  const removeWorkType = useCallback((name: string) => {
    setWorkTypes((prev) => prev.filter((w) => w.name !== name));
  }, []);

  const renameWorkType = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    setWorkTypes((prev) =>
      prev.map((w) => (w.name === oldName ? { ...w, name: trimmed } : w)),
    );
  }, []);

  const setWorkTypeParents = useCallback((name: string, parents: string[]) => {
    setWorkTypes((prev) =>
      prev.map((w) => (w.name === name ? { ...w, parents } : w)),
    );
  }, []);

  const setSubCategoryClients = useCallback((name: string, clients: string[]) => {
    setSubCategories((prev) =>
      prev.map((s) => (s.name === name ? { ...s, clients } : s)),
    );
  }, []);

  // ------------------- Inference rules ------------------------------

  const updateInferenceRules = useCallback(
    (rules: readonly InferenceRule[]) => {
      setInferenceRules(rules);
    },
    [],
  );

  // ------------------- Backward-compat derived fields ---------------
  //
  // Consumers not yet refactored to the new API see the same shapes
  // they always did. Removed once Turns 5-7 migrate each consumer
  // (Workspace, ReviewEditor, etc.).

  const categories = mainCategories;

  // Mock mode has no MainCategory.clients store — rosters live only on sub
  // categories in the seed taxonomy, so the main tier contributes nothing.
  const clientsByParent = useMemo(
    () => buildClientsByParent(subCategories, {}),
    [subCategories],
  );

  const setMainCategoryClients = useCallback((_name: string, _next: string[]) => {
    // No-op in mock mode: the seed taxonomy keeps every roster on a sub
    // category, so there is no main-tier roster to write. API mode
    // implements this for real.
  }, []);

  const workTypesByCategory = useMemo<
    Readonly<Record<string, readonly string[]>>
  >(() => {
    // For each main cat, gather work types that apply either (a)
    // directly via the main cat being a parent, or (b) via any sub
    // cat whose parent is this main cat. Deduplicate by name.
    const out: Record<string, string[]> = {};
    for (const main of mainCategories) {
      const subs = subCategories
        .filter((s) => s.parentMainCategory === main)
        .map((s) => s.name);
      const parentNames = new Set([main, ...subs]);
      const names = new Set<string>();
      for (const wt of workTypes) {
        if (wt.parents.some((p) => parentNames.has(p))) {
          names.add(wt.name);
        }
      }
      out[main] = Array.from(names);
    }
    return out;
  }, [mainCategories, subCategories, workTypes]);

  // ------------------- Value ----------------------------------------

  const value = useMemo<ClientsConfigContextType>(
    () => ({
      teams,
      clients,
      sharedClientList,
      addTeam,
      removeTeam,
      renameTeam,
      addClient,
      removeClient,
      renameClient,

      enhancements,
      addEnhancement,
      removeEnhancement,
      renameEnhancement,

      mainCategories,
      subCategories,
      workTypes,
      subCategoriesForMain,
      workTypesForParent,
      addMainCategory,
      removeMainCategory,
      renameMainCategory,
      addSubCategory,
      removeSubCategory,
      renameSubCategory,
      addWorkType,
      removeWorkType,
      renameWorkType,
      setWorkTypeParents,
      setSubCategoryClients,
      setMainCategoryClients,
      clientsByParent,

      inferenceRules,
      updateInferenceRules,

      categories,
      workTypesByCategory,
    }),
    [
      teams,
      clients,
      sharedClientList,
      addTeam,
      removeTeam,
      renameTeam,
      addClient,
      removeClient,
      renameClient,
      enhancements,
      addEnhancement,
      removeEnhancement,
      renameEnhancement,
      mainCategories,
      subCategories,
      workTypes,
      subCategoriesForMain,
      workTypesForParent,
      addMainCategory,
      removeMainCategory,
      renameMainCategory,
      addSubCategory,
      removeSubCategory,
      renameSubCategory,
      addWorkType,
      removeWorkType,
      renameWorkType,
      setWorkTypeParents,
      setSubCategoryClients,
      setMainCategoryClients,
      clientsByParent,
      inferenceRules,
      updateInferenceRules,
      categories,
      workTypesByCategory,
    ],
  );

  return (
    <ClientsConfigContext.Provider value={value}>
      {children}
    </ClientsConfigContext.Provider>
  );
};

// =====================================================================
// API mode provider — React Query backed
// =====================================================================

const ApiClientsConfigProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  const { data: snap } = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => api.settings.snapshot(signal),
    staleTime: 5 * 60 * 1000,
  });

  const teams = useMemo<readonly string[]>(
    () => snap?.teams.map((t) => t.name) ?? SEED_TEAMS,
    [snap],
  );
  const clients = useMemo<readonly string[]>(
    () => snap?.clients.map((c) => c.name) ?? SEED_CLIENTS,
    [snap],
  );
  /**
   * Live Enhancement roster. Falls back to the shared defaults ONLY while the
   * snapshot is still loading — once `snap` arrives the server is the sole
   * authority, even if it returns an empty list (an Admin may have cleared it).
   * Using `?? DEFAULT` here instead would resurrect deleted tags forever.
   */
  const enhancements = useMemo<readonly string[]>(
    () => (snap ? snap.enhancements.map((e) => e.name) : DEFAULT_ENHANCEMENT_TAGS),
    [snap],
  );
  const mainCategories = useMemo<readonly string[]>(
    () => snap?.mainCategories.map((m) => m.name) ?? SEED_MAIN_CATEGORIES,
    [snap],
  );
  /**
   * Main-category rosters straight off the snapshot. Kept separate from
   * `mainCategories` (a plain string[]) so the widely-consumed shape of
   * that field doesn't change.
   */
  const mainCategoryClients = useMemo<Readonly<Record<string, readonly string[]>>>(
    () => {
      const out: Record<string, readonly string[]> = {};
      for (const m of snap?.mainCategories ?? []) {
        if (m.clients && m.clients.length > 0) out[m.name] = m.clients;
      }
      return out;
    },
    [snap],
  );
  const subCategories = useMemo<readonly SubCategory[]>(
    () =>
      snap?.subCategories.map((s) => ({
        name: s.name,
        parentMainCategory: s.parentMainCategory,
        clients: s.clients,
      })) ?? SEED_SUB_CATEGORIES,
    [snap],
  );
  const workTypes = useMemo<readonly WorkType[]>(
    () =>
      snap?.workTypes.map((w) => ({ name: w.name, parents: w.parents })) ??
      SEED_WORK_TYPES,
    [snap],
  );
  const inferenceRules = useMemo<readonly InferenceRule[]>(
    () =>
      snap?.inferenceRules.map((r) => ({
        keywords: r.keywords,
        category: r.category,
        subCategory: r.subCategory,
        workType: r.workType,
      })) ?? DEFAULT_INFERENCE_RULES,
    [snap],
  );

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
    [queryClient],
  );

  // Stores rules auto-generated by the last setSubCategoryClients /
  // setWorkTypeParents call. Read by AdminSettings to surface the
  // inference-summary modal.
  const [lastAutoGeneratedRules, setLastAutoGeneratedRules] = useState<Array<{
    id: number; keywords: string[]; category: string;
    subCategory: string | null; workType: string; sortOrder: number;
  }> | null>(null);
  const clearLastAutoGeneratedRules = useCallback(() => setLastAutoGeneratedRules(null), []);

  // ── Teams ────────────────────────────────────────────────────────────

  const addTeamMut = useMutation({
    mutationFn: (name: string) => api.settings.createTeam(name),
    onSuccess: invalidate,
  });
  const addTeam = useCallback(
    (name: string) => {
      const t = name.trim();
      if (t) addTeamMut.mutate(t);
    },
    [addTeamMut],
  );

  const removeTeamMut = useMutation({
    mutationFn: (id: number) => api.settings.deleteTeam(id),
    onSuccess: invalidate,
  });
  const removeTeam = useCallback(
    (name: string) => {
      const id = snap?.teams.find((t) => t.name === name)?.id;
      if (id !== undefined) removeTeamMut.mutate(id);
    },
    [removeTeamMut, snap],
  );

  const renameTeamMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.settings.renameTeam(id, name),
    onSuccess: invalidate,
  });
  const renameTeam = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      const id = snap?.teams.find((t) => t.name === oldName)?.id;
      if (trimmed && trimmed !== oldName && id !== undefined)
        renameTeamMut.mutate({ id, name: trimmed });
    },
    [renameTeamMut, snap],
  );

  // ── Clients ──────────────────────────────────────────────────────────

  const addClientMut = useMutation({
    mutationFn: (name: string) => api.settings.createClient(name),
    onSuccess: invalidate,
  });
  const addClient = useCallback(
    (name: string) => {
      const t = name.trim();
      if (t) addClientMut.mutate(t);
    },
    [addClientMut],
  );

  const removeClientMut = useMutation({
    mutationFn: (id: number) => api.settings.deleteClient(id),
    onSuccess: invalidate,
  });
  const removeClient = useCallback(
    (name: string) => {
      const id = snap?.clients.find((c) => c.name === name)?.id;
      if (id !== undefined) removeClientMut.mutate(id);
    },
    [removeClientMut, snap],
  );

  const addEnhancementMut = useMutation({
    mutationFn: (name: string) => api.settings.createEnhancement(name),
    onSuccess: invalidate,
  });
  const addEnhancement = useCallback(
    (name: string) => {
      const t = name.trim();
      if (t) addEnhancementMut.mutate(t);
    },
    [addEnhancementMut],
  );

  const removeEnhancementMut = useMutation({
    mutationFn: (id: number) => api.settings.deleteEnhancement(id),
    onSuccess: invalidate,
  });
  const removeEnhancement = useCallback(
    (name: string) => {
      const id = snap?.enhancements.find((e) => e.name === name)?.id;
      if (id !== undefined) removeEnhancementMut.mutate(id);
    },
    [removeEnhancementMut, snap],
  );

  const renameEnhancementMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.settings.renameEnhancement(id, name),
    onSuccess: invalidate,
  });
  const renameEnhancement = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      const id = snap?.enhancements.find((e) => e.name === oldName)?.id;
      if (trimmed && trimmed !== oldName && id !== undefined)
        renameEnhancementMut.mutate({ id, name: trimmed });
    },
    [renameEnhancementMut, snap],
  );

  const renameClientMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.settings.renameClient(id, name),
    onSuccess: invalidate,
  });
  const renameClient = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      const id = snap?.clients.find((c) => c.name === oldName)?.id;
      if (trimmed && trimmed !== oldName && id !== undefined)
        renameClientMut.mutate({ id, name: trimmed });
    },
    [renameClientMut, snap],
  );

  // ── Main categories ──────────────────────────────────────────────────

  const addMainCatMut = useMutation({
    mutationFn: (name: string) => api.settings.createMainCategory(name),
    onSuccess: invalidate,
  });
  const addMainCategory = useCallback(
    (name: string) => {
      const t = name.trim();
      if (t) addMainCatMut.mutate(t);
    },
    [addMainCatMut],
  );

  const removeMainCatMut = useMutation({
    mutationFn: (id: number) => api.settings.deleteMainCategory(id),
    onSuccess: invalidate,
  });
  const removeMainCategory = useCallback(
    (name: string) => {
      const id = snap?.mainCategories.find((m) => m.name === name)?.id;
      if (id !== undefined) removeMainCatMut.mutate(id);
    },
    [removeMainCatMut, snap],
  );

  const renameMainCatMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.settings.renameMainCategory(id, name),
    onMutate: async ({ id, name: newName }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const prev = queryClient.getQueryData<ApiSettingsSnapshot>(["settings"]);
      if (prev) {
        const oldCat = prev.mainCategories.find((m) => m.id === id);
        if (oldCat) {
          const oldName = oldCat.name;
          queryClient.setQueryData<ApiSettingsSnapshot>(["settings"], {
            ...prev,
            mainCategories: prev.mainCategories.map((m) =>
              m.id === id ? { ...m, name: newName } : m
            ),
            subCategories: prev.subCategories.map((s) =>
              s.mainCategoryId === id ? { ...s, parentMainCategory: newName } : s
            ),
            workTypes: prev.workTypes.map((wt) => ({
              ...wt,
              parents: wt.parents.map((p) => (p === oldName ? newName : p)),
            })),
          });
        }
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(["settings"], context.prev);
    },
    onSuccess: invalidate,
  });
  const renameMainCategory = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      const id = snap?.mainCategories.find((m) => m.name === oldName)?.id;
      if (trimmed && trimmed !== oldName && id !== undefined)
        renameMainCatMut.mutate({ id, name: trimmed });
    },
    [renameMainCatMut, snap],
  );

  // ── Sub categories ───────────────────────────────────────────────────

  const addSubCatMut = useMutation({
    mutationFn: ({
      name,
      parentMainCategoryId,
    }: {
      name: string;
      parentMainCategoryId: number;
    }) => api.settings.createSubCategory({ name, parentMainCategoryId }),
    onSuccess: invalidate,
  });
  const addSubCategory = useCallback(
    (name: string, parentMainCategory: string) => {
      const trimmed = name.trim();
      const parentId = snap?.mainCategories.find(
        (m) => m.name === parentMainCategory,
      )?.id;
      if (trimmed && parentId !== undefined)
        addSubCatMut.mutate({ name: trimmed, parentMainCategoryId: parentId });
    },
    [addSubCatMut, snap],
  );

  const removeSubCatMut = useMutation({
    mutationFn: (id: number) => api.settings.deleteSubCategory(id),
    onSuccess: invalidate,
  });
  const removeSubCategory = useCallback(
    (name: string) => {
      const id = snap?.subCategories.find((s) => s.name === name)?.id;
      if (id !== undefined) removeSubCatMut.mutate(id);
    },
    [removeSubCatMut, snap],
  );

  const renameSubCatMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.settings.renameSubCategory(id, name),
    onMutate: async ({ id, name: newName }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const prev = queryClient.getQueryData<ApiSettingsSnapshot>(["settings"]);
      if (prev) {
        const oldSub = prev.subCategories.find((s) => s.id === id);
        if (oldSub) {
          const oldName = oldSub.name;
          queryClient.setQueryData<ApiSettingsSnapshot>(["settings"], {
            ...prev,
            subCategories: prev.subCategories.map((s) =>
              s.id === id ? { ...s, name: newName } : s
            ),
            workTypes: prev.workTypes.map((wt) => ({
              ...wt,
              parents: wt.parents.map((p) => (p === oldName ? newName : p)),
            })),
          });
        }
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(["settings"], context.prev);
    },
    onSuccess: invalidate,
  });
  const renameSubCategory = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      const id = snap?.subCategories.find((s) => s.name === oldName)?.id;
      if (trimmed && trimmed !== oldName && id !== undefined)
        renameSubCatMut.mutate({ id, name: trimmed });
    },
    [renameSubCatMut, snap],
  );

  const setSubCatClientsMut = useMutation({
    mutationFn: ({ id, clients: cls }: { id: number; clients: string[] }) =>
      api.settings.setSubCategoryClients(id, cls),
    onSuccess: (data) => {
      invalidate();
      if (data.generatedRules.length > 0)
        setLastAutoGeneratedRules((prev) => [...(prev ?? []), ...data.generatedRules]);
    },
  });
  const setSubCategoryClients = useCallback(
    (name: string, cls: string[]) => {
      const id = snap?.subCategories.find((s) => s.name === name)?.id;
      if (id !== undefined) setSubCatClientsMut.mutate({ id, clients: cls });
    },
    [setSubCatClientsMut, snap],
  );

  // Main-category roster. Unlike the sub-category twin this returns no
  // generated rules — rule generation is driven by work-type parenting,
  // which a roster edit doesn't change.
  const setMainCatClientsMut = useMutation({
    mutationFn: ({ id, clients: cls }: { id: number; clients: string[] }) =>
      api.settings.setMainCategoryClients(id, cls),
    onSuccess: () => invalidate(),
  });
  const setMainCategoryClients = useCallback(
    (name: string, cls: string[]) => {
      const id = snap?.mainCategories.find((m) => m.name === name)?.id;
      if (id !== undefined) setMainCatClientsMut.mutate({ id, clients: cls });
    },
    [setMainCatClientsMut, snap],
  );

  // ── Work types ───────────────────────────────────────────────────────

  const addWorkTypeMut = useMutation({
    mutationFn: ({ name, parents }: { name: string; parents: string[] }) =>
      api.settings.createWorkType(name, parents),
    onSuccess: (data) => {
      invalidate();
      if (data.generatedRules.length > 0)
        setLastAutoGeneratedRules((prev) => [...(prev ?? []), ...data.generatedRules]);
    },
  });
  const addWorkType = useCallback(
    (name: string, parents: string[]) => {
      const t = name.trim();
      if (t) addWorkTypeMut.mutate({ name: t, parents });
    },
    [addWorkTypeMut],
  );

  const removeWorkTypeMut = useMutation({
    mutationFn: (id: number) => api.settings.deleteWorkType(id),
    onSuccess: invalidate,
  });
  const removeWorkType = useCallback(
    (name: string) => {
      const id = snap?.workTypes.find((w) => w.name === name)?.id;
      if (id !== undefined) removeWorkTypeMut.mutate(id);
    },
    [removeWorkTypeMut, snap],
  );

  const renameWorkTypeMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.settings.renameWorkType(id, name),
    onSuccess: invalidate,
  });
  const renameWorkType = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      const id = snap?.workTypes.find((w) => w.name === oldName)?.id;
      if (trimmed && trimmed !== oldName && id !== undefined)
        renameWorkTypeMut.mutate({ id, name: trimmed });
    },
    [renameWorkTypeMut, snap],
  );

  const setWorkTypeParentsMut = useMutation({
    mutationFn: ({ id, parents }: { id: number; parents: string[] }) =>
      api.settings.setWorkTypeParents(id, parents),
    // Optimistically patch the query cache so the Outline re-renders
    // immediately — without this the node stays visible until the API
    // round-trip + background refetch complete (~300–500 ms).
    onMutate: async ({ id, parents }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous = queryClient.getQueryData(["settings"]);
      queryClient.setQueryData(["settings"], (old: unknown) => {
        const data = old as { workTypes?: Array<{ id: number; name: string; parents: string[] }> } | undefined;
        if (!data?.workTypes) return old;
        return {
          ...data,
          workTypes: data.workTypes.map((w) =>
            w.id === id ? { ...w, parents } : w,
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context: { previous: unknown } | undefined) => {
      if (context?.previous)
        queryClient.setQueryData(["settings"], context.previous);
    },
    onSuccess: (data) => {
      invalidate();
      if (data.generatedRules.length > 0)
        setLastAutoGeneratedRules((prev) => [...(prev ?? []), ...data.generatedRules]);
    },
  });
  const setWorkTypeParents = useCallback(
    (name: string, parents: string[]) => {
      const id = snap?.workTypes.find((w) => w.name === name)?.id;
      if (id !== undefined) setWorkTypeParentsMut.mutate({ id, parents });
    },
    [setWorkTypeParentsMut, snap],
  );

  const bulkSetWorkTypeParentsMut = useMutation({
    mutationFn: (updates: Array<{ id: number; parents: string[] }>) =>
      api.settings.bulkUpdateWorkTypeParents(updates),
    onSuccess: (data) => {
      invalidate();
      if (data.generatedRules.length > 0)
        setLastAutoGeneratedRules((prev) => [...(prev ?? []), ...data.generatedRules]);
    },
  });
  const bulkSetWorkTypeParents = useCallback(
    (names: string[], targetParent: string) => {
      const updates = names.flatMap((name) => {
        const wt = snap?.workTypes.find((w) => w.name === name);
        if (!wt) return [];
        return [{ id: wt.id, parents: [...wt.parents, targetParent] }];
      });
      if (updates.length > 0) bulkSetWorkTypeParentsMut.mutate(updates);
    },
    [bulkSetWorkTypeParentsMut, snap],
  );

  // ── Inference rules ──────────────────────────────────────────────────

  const updateInferenceRulesMut = useMutation({
    mutationFn: (rules: readonly InferenceRule[]) =>
      api.settings.bulkReplaceInferenceRules(
        rules.map((r, i) => ({
          keywords: [...r.keywords],
          category: r.category,
          subCategory: r.subCategory ?? null,
          workType: r.workType,
          sortOrder: i,
        })),
      ),
    onSuccess: invalidate,
  });
  const updateInferenceRules = useCallback(
    (rules: readonly InferenceRule[]) =>
      updateInferenceRulesMut.mutate(rules),
    [updateInferenceRulesMut],
  );

  // ── Queries ──────────────────────────────────────────────────────────

  const subCategoriesForMain = useCallback(
    (main: string) => subCategories.filter((s) => s.parentMainCategory === main),
    [subCategories],
  );

  const workTypesForParent = useCallback(
    (parentName: string) =>
      workTypes.filter((w) => w.parents.includes(parentName)),
    [workTypes],
  );

  // ── Backward-compat derived fields ───────────────────────────────────

  const categories = mainCategories;

  const clientsByParent = useMemo(
    () => buildClientsByParent(subCategories, mainCategoryClients),
    [subCategories, mainCategoryClients],
  );

  const workTypesByCategory = useMemo<Readonly<Record<string, readonly string[]>>>(
    () => {
      const out: Record<string, string[]> = {};
      for (const main of mainCategories) {
        const subs = subCategories
          .filter((s) => s.parentMainCategory === main)
          .map((s) => s.name);
        const parentNames = new Set([main, ...subs]);
        const names = new Set<string>();
        for (const wt of workTypes) {
          if (wt.parents.some((p) => parentNames.has(p))) names.add(wt.name);
        }
        out[main] = Array.from(names);
      }
      return out;
    },
    [mainCategories, subCategories, workTypes],
  );

  const sharedClientList = useMemo(
    () => buildSharedClientList(clients),
    [clients],
  );

  // ── Value ────────────────────────────────────────────────────────────

  const value = useMemo<ClientsConfigContextType>(
    () => ({
      teams,
      clients,
      sharedClientList,
      addTeam,
      removeTeam,
      renameTeam,
      addClient,
      removeClient,
      renameClient,

      enhancements,
      addEnhancement,
      removeEnhancement,
      renameEnhancement,
      mainCategories,
      subCategories,
      workTypes,
      subCategoriesForMain,
      workTypesForParent,
      addMainCategory,
      removeMainCategory,
      renameMainCategory,
      addSubCategory,
      removeSubCategory,
      renameSubCategory,
      addWorkType,
      removeWorkType,
      renameWorkType,
      setWorkTypeParents,
      bulkSetWorkTypeParents,
      setSubCategoryClients,
      setMainCategoryClients,
      clientsByParent,
      inferenceRules,
      updateInferenceRules,
      lastAutoGeneratedRules,
      clearLastAutoGeneratedRules,
      categories,
      workTypesByCategory,
    }),
    [
      teams,
      clients,
      sharedClientList,
      addTeam,
      removeTeam,
      renameTeam,
      addClient,
      removeClient,
      renameClient,
      enhancements,
      addEnhancement,
      removeEnhancement,
      renameEnhancement,
      mainCategories,
      subCategories,
      workTypes,
      subCategoriesForMain,
      workTypesForParent,
      addMainCategory,
      removeMainCategory,
      renameMainCategory,
      addSubCategory,
      removeSubCategory,
      renameSubCategory,
      addWorkType,
      removeWorkType,
      renameWorkType,
      setWorkTypeParents,
      bulkSetWorkTypeParents,
      setSubCategoryClients,
      setMainCategoryClients,
      clientsByParent,
      inferenceRules,
      updateInferenceRules,
      lastAutoGeneratedRules,
      clearLastAutoGeneratedRules,
      categories,
      workTypesByCategory,
    ],
  );

  return (
    <ClientsConfigContext.Provider value={value}>
      {children}
    </ClientsConfigContext.Provider>
  );
};

// =====================================================================
// Dispatching public export
// =====================================================================

export const ClientsConfigProvider = ({ children }: { children: ReactNode }) =>
  import.meta.env.VITE_USE_API === "true" ? (
    <ApiClientsConfigProvider>{children}</ApiClientsConfigProvider>
  ) : (
    <LocalClientsConfigProvider>{children}</LocalClientsConfigProvider>
  );
