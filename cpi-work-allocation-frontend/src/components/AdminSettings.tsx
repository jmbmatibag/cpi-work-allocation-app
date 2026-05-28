import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Trash2,
  Search,
  Pencil,
  Settings2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronLeft,
  Users as UsersIcon,
  Tag as TagIcon,
  Building2,
  Layers,
  Wrench,
  Network,
  Folder,
  X,
  Link2,
  Sparkles,
  Eye,
  EyeOff,
  Loader2,
  ShieldAlert,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useClientsConfig,
  type WorkType,
  type SubCategory,
} from "@/contexts/ClientsConfigContext";
import { useEmployees } from "@/contexts/EmployeesContext";
import { useAllocations } from "@/contexts/AllocationsContext";
import { useJournal } from "@/contexts/JournalContext";
import { useAIConfig } from "@/contexts/AIConfigContext";
import { testApiKey } from "@/lib/aiParser";
import InferenceRulesEditor from "@/components/InferenceRulesEditor";
import EmailSettingsConfig from "@/components/EmailSettingsConfig";
import { toast } from "sonner";

/** Feature flag — Inference Rules tab hidden in production. */
const SHOW_INFERENCE_RULES_TAB = true;

/** Pagination — items per page for the flat Taxonomy tables. */
const PAGE_SIZE = 10;

// =====================================================================
// Types
// =====================================================================

type TabKey = "teams" | "clients" | "taxonomy" | "ai" | "inference" | "email";
type TaxonomyView = "outline" | "main" | "sub" | "workType";
type SortDirection = "asc" | "desc";

type DeleteTarget =
  | { type: "team";         name: string }
  | { type: "client";       name: string }
  | { type: "mainCategory"; name: string; subCount: number; workTypeCount: number }
  | { type: "subCategory";  name: string; workTypeCount: number }
  | { type: "workType";     name: string; parentCount: number };

type AddContext =
  | { type: "team" }
  | { type: "client" }
  | { type: "mainCategory" }
  | { type: "subCategory";   parentMain?: string }
  | { type: "workType";      parentName?: string };

type EditTarget =
  | { kind: "team";         name: string }
  | { kind: "client";       name: string }
  | { kind: "mainCategory"; name: string }
  | { kind: "subCategory";  name: string }
  | { kind: "workType";     name: string };

// =====================================================================
// Component
// =====================================================================

const AdminSettings = () => {
  const cc = useClientsConfig();
  const employees = useEmployees();
  const allocations = useAllocations();
  const journal = useJournal();

  const {
    teams,
    clients,
    mainCategories,
    subCategories,
    workTypes,
    subCategoriesForMain,
    addTeam,
    removeTeam,
    renameTeam,
    addClient,
    removeClient,
    renameClient,
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
  } = cc;

  // --- State --------------------------------------------------------
  const [activeTab, setActiveTab] = useState<TabKey>("teams");
  const [taxonomyView, setTaxonomyView] = useState<TaxonomyView>("outline");
  const [search, setSearch] = useState("");

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [initializedCollapsed, setInitializedCollapsed] = useState(false);

  useEffect(() => {
    if (!initializedCollapsed && mainCategories.length > 0) {
      setCollapsed(new Set(mainCategories));
      setInitializedCollapsed(true);
    }
  }, [mainCategories, initializedCollapsed]);

  const toggleCollapsed = (main: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(main)) next.delete(main);
      else next.add(main);
      return next;
    });
  };

  // Sort + pagination state per flat table
  const [mainSort, setMainSort] = useState<{ col: "name" | "subs" | "types"; dir: SortDirection }>({ col: "name", dir: "asc" });
  const [subSort, setSubSort]   = useState<{ col: "name" | "parent" | "types"; dir: SortDirection }>({ col: "name", dir: "asc" });
  const [wtSort,  setWtSort]    = useState<{ col: "name" | "parents"; dir: SortDirection }>({ col: "name", dir: "asc" });

  const [mainPage, setMainPage] = useState(1);
  const [subPage, setSubPage]   = useState(1);
  const [wtPage, setWtPage]     = useState(1);

  useEffect(() => {
    setMainPage(1);
    setSubPage(1);
    setWtPage(1);
  }, [search, taxonomyView]);

  // Modals
  const [addCtx, setAddCtx] = useState<AddContext | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // --- Derived ------------------------------------------------------
  const q = search.trim().toLowerCase();
  const searchActive = q !== "";

  const outlineSections = useMemo(() => {
    return mainCategories.map((main) => {
      const subs = subCategoriesForMain(main);
      const mainMatches = !searchActive || main.toLowerCase().includes(q);

      const directWorkTypes = subs.length === 0
        ? workTypes.filter((w) => w.parents.includes(main))
        : [];
      const subSectionsFull = subs.map((sub) => ({
        sub,
        workTypes: workTypes.filter((w) => w.parents.includes(sub.name)),
      }));

      if (mainMatches || !searchActive) {
        return {
          main,
          directWorkTypes,
          subSections: subSectionsFull,
          totalWorkTypeCount:
            directWorkTypes.length +
            subSectionsFull.reduce((a, s) => a + s.workTypes.length, 0),
          subCount: subs.length,
          include: true,
        };
      }

      const filteredDirectWTs = directWorkTypes.filter((w) =>
        w.name.toLowerCase().includes(q),
      );
      const filteredSubSections = subSectionsFull
        .map(({ sub, workTypes: wts }) => {
          const subMatches = sub.name.toLowerCase().includes(q);
          return {
            sub,
            workTypes: subMatches
              ? wts
              : wts.filter((w) => w.name.toLowerCase().includes(q)),
            subMatches,
          };
        })
        .filter((s) => s.subMatches || s.workTypes.length > 0);

      return {
        main,
        directWorkTypes: filteredDirectWTs,
        subSections: filteredSubSections,
        totalWorkTypeCount:
          filteredDirectWTs.length +
          filteredSubSections.reduce((a, s) => a + s.workTypes.length, 0),
        subCount: subs.length,
        include: filteredDirectWTs.length > 0 || filteredSubSections.length > 0,
      };
    });
  }, [mainCategories, subCategoriesForMain, workTypes, q, searchActive]);

  const filteredTeams = useMemo(
    () => [...teams].sort((a, b) => a.localeCompare(b)).filter((t) => !q || t.toLowerCase().includes(q)),
    [teams, q],
  );
  const filteredClients = useMemo(
    () => [...clients].sort((a, b) => a.localeCompare(b)).filter((c) => !q || c.toLowerCase().includes(q)),
    [clients, q],
  );

  const sortedMainCategories = useMemo(() => {
    const filtered = mainCategories.filter((m) => !q || m.toLowerCase().includes(q));
    return [...filtered].sort((a, b) => {
      const subsA = subCategoriesForMain(a).length;
      const subsB = subCategoriesForMain(b).length;
      const tA = workTypes.filter((w) => w.parents.includes(a)).length;
      const tB = workTypes.filter((w) => w.parents.includes(b)).length;
      let cmp = 0;
      switch (mainSort.col) {
        case "name":  cmp = a.localeCompare(b); break;
        case "subs":  cmp = subsA - subsB; break;
        case "types": cmp = tA - tB; break;
      }
      return mainSort.dir === "asc" ? cmp : -cmp;
    });
  }, [mainCategories, subCategoriesForMain, workTypes, mainSort, q]);

  const sortedSubCategories = useMemo(() => {
    const filtered = subCategories.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.parentMainCategory.toLowerCase().includes(q),
    );
    return [...filtered].sort((a, b) => {
      const tA = workTypes.filter((w) => w.parents.includes(a.name)).length;
      const tB = workTypes.filter((w) => w.parents.includes(b.name)).length;
      let cmp = 0;
      switch (subSort.col) {
        case "name":   cmp = a.name.localeCompare(b.name); break;
        case "parent": cmp = a.parentMainCategory.localeCompare(b.parentMainCategory); break;
        case "types":  cmp = tA - tB; break;
      }
      return subSort.dir === "asc" ? cmp : -cmp;
    });
  }, [subCategories, workTypes, subSort, q]);

  const sortedWorkTypes = useMemo(() => {
    const filtered = workTypes.filter(
      (w) => !q || w.name.toLowerCase().includes(q) || w.parents.some((p) => p.toLowerCase().includes(q)),
    );
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (wtSort.col) {
        case "name":    cmp = a.name.localeCompare(b.name); break;
        case "parents": cmp = a.parents.length - b.parents.length; break;
      }
      return wtSort.dir === "asc" ? cmp : -cmp;
    });
  }, [workTypes, wtSort, q]);

  const pagedMain = paginate(sortedMainCategories, mainPage);
  const pagedSub = paginate(sortedSubCategories, subPage);
  const pagedWorkType = paginate(sortedWorkTypes, wtPage);

  const parentGroups = useMemo(() => {
    return mainCategories.map((main) => {
      const subs = subCategoriesForMain(main);
      return {
        main,
        items: subs.length === 0 ? [main] : subs.map((s) => s.name),
        hasSubs: subs.length > 0,
      };
    });
  }, [mainCategories, subCategoriesForMain]);

  // --- Tab change resets search -------------------------------------
  const handleTabChange = (next: TabKey) => {
    setActiveTab(next);
    setSearch("");
  };

  // --- Cascading rename for team/client -----------------------------
  //
  // Coordinates the three denormalized stores (employees, allocation
  // records, journal entry content) when a team or client is renamed
  // so all references stay consistent.
  const cascadeRenameTeam = (oldName: string, newName: string) => {
    renameTeam(oldName, newName);
    employees.renameTeam?.(oldName, newName);
    allocations.renameTeam?.(oldName, newName);
    toast.success(
      `Team renamed. Propagated to ${employees.employees.filter((e) => e.team === newName).length} employees and all allocation records.`,
    );
  };

  const cascadeRenameClient = (oldName: string, newName: string) => {
    renameClient(oldName, newName);
    allocations.renameClient?.(oldName, newName);
    journal.renameClientTag?.(oldName, newName);
    toast.success(
      "Client renamed. Propagated to allocation records and journal @-tags.",
    );
  };

  // --- Add flow -----------------------------------------------------
  const openAdd = (ctx: AddContext) => setAddCtx(ctx);
  const closeAdd = () => setAddCtx(null);

  const handleSimpleAdd = (name: string) => {
    if (!addCtx) return;
    switch (addCtx.type) {
      case "team":
        addTeam(name);
        toast.success("Team added.");
        break;
      case "client":
        addClient(name);
        toast.success("Client added.");
        break;
      case "mainCategory":
        addMainCategory(name);
        toast.success("Main category added.");
        break;
    }
    closeAdd();
  };

  // --- Delete handler -----------------------------------------------
  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    switch (deleteTarget.type) {
      case "team":         removeTeam(deleteTarget.name); break;
      case "client":       removeClient(deleteTarget.name); break;
      case "mainCategory": removeMainCategory(deleteTarget.name); break;
      case "subCategory":  removeSubCategory(deleteTarget.name); break;
      case "workType":     removeWorkType(deleteTarget.name); break;
    }
    toast.success("Deleted.");
    setDeleteTarget(null);
    setEditTarget(null);
  };

  // --- Meta ---------------------------------------------------------
  const tabs = [
    { key: "teams"     as TabKey, label: "Teams",    icon: UsersIcon, count: teams.length,         visible: true },
    { key: "clients"   as TabKey, label: "Clients",  icon: Building2, count: clients.length,       visible: true },
    { key: "taxonomy"  as TabKey, label: "Taxonomy", icon: Network,   count: mainCategories.length, visible: true },
    { key: "ai"        as TabKey, label: "AI",       icon: Sparkles,  count: 0,                     visible: false },
    { key: "inference" as TabKey, label: "Inference Rules", icon: TagIcon, count: 0, visible: SHOW_INFERENCE_RULES_TAB },
    { key: "email"     as TabKey, label: "Email",          icon: Mail,    count: 0, visible: true },
  ];

  const taxonomyViews: Array<{ key: TaxonomyView; label: string; icon: typeof Folder }> = [
    { key: "outline",  label: "Outline",         icon: Network },
    { key: "main",     label: "Main Categories", icon: Folder },
    { key: "sub",      label: "Sub Categories",  icon: Layers },
    { key: "workType", label: "Work Types",      icon: Wrench },
  ];

  const searchPlaceholder =
    activeTab === "teams"    ? "Search teams"
  : activeTab === "clients"  ? "Search clients"
  : activeTab === "taxonomy" ? "Search categories or work types"
  : "";

  // =====================================================================
  // Render
  // =====================================================================

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-y-auto" style={{ background: "hsl(220 14% 98%)" }}>
      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-1.5">
            <Settings2 className="h-4 w-4" style={{ color: "hsl(220 10% 40%)" }} />
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "hsl(220 10% 40%)" }}>
              Workspace Settings
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: "hsl(222 20% 15%)" }}>
            Data & Taxonomy
          </h1>
          <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "hsl(220 10% 45%)" }}>
            Manage the teams, clients, and three-level taxonomy powering the app.{" "}
            <span style={{ color: "hsl(220 8% 55%)" }}>Changes apply immediately for all users.</span>
          </p>
        </div>

        {/* Primary tab bar */}
        <div className="mb-6">
          <div role="tablist" className="inline-flex items-center gap-0.5 p-1 rounded-lg"
            style={{ background: "hsl(220 14% 95%)", border: "1px solid hsl(220 13% 91%)" }}>
            {tabs.filter((t) => t.visible).map((tab) => {
              const active = tab.key === activeTab;
              const Icon = tab.icon;
              return (
                <button key={tab.key} role="tab" aria-selected={active} onClick={() => handleTabChange(tab.key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all"
                  style={{
                    background: active ? "hsl(0 0% 100%)" : "transparent",
                    color: active ? "hsl(222 20% 15%)" : "hsl(220 10% 40%)",
                    boxShadow: active ? "0 1px 2px 0 hsl(220 13% 85% / 0.5), 0 0 0 1px hsl(220 13% 88%)" : "none",
                  }}>
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className="text-[11px] ml-0.5 tabular-nums"
                      style={{ color: active ? "hsl(220 10% 50%)" : "hsl(220 8% 55%)" }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Teams */}
        {activeTab === "teams" && (
          <SimpleGridCard
            items={filteredTeams}
            totalCount={teams.length}
            search={search} onSearch={setSearch}
            searchPlaceholder={searchPlaceholder}
            addLabel="Add Team"
            onAdd={() => openAdd({ type: "team" })}
            onEdit={(name) => setEditTarget({ kind: "team", name })}
            onDelete={(name) => setDeleteTarget({ type: "team", name })}
            emptyText="No teams yet."
          />
        )}

        {/* Clients */}
        {activeTab === "clients" && (
          <SimpleGridCard
            items={filteredClients}
            totalCount={clients.length}
            search={search} onSearch={setSearch}
            searchPlaceholder={searchPlaceholder}
            addLabel="Add Client"
            onAdd={() => openAdd({ type: "client" })}
            onEdit={(name) => setEditTarget({ kind: "client", name })}
            onDelete={(name) => setDeleteTarget({ type: "client", name })}
            emptyText="No clients yet."
          />
        )}

        {/* Taxonomy */}
        {activeTab === "taxonomy" && (
          <div className="space-y-4">
            {/* View toggle */}
            <div className="inline-flex items-center gap-0.5 p-1 rounded-lg"
              style={{ background: "hsl(220 14% 95%)", border: "1px solid hsl(220 13% 91%)" }}>
              {taxonomyViews.map((view) => {
                const active = view.key === taxonomyView;
                const Icon = view.icon;
                return (
                  <button key={view.key} onClick={() => setTaxonomyView(view.key)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all"
                    style={{
                      background: active ? "hsl(0 0% 100%)" : "transparent",
                      color: active ? "hsl(222 20% 15%)" : "hsl(220 10% 45%)",
                      boxShadow: active ? "0 1px 2px 0 hsl(220 13% 85% / 0.5), 0 0 0 1px hsl(220 13% 88%)" : "none",
                    }}>
                    <Icon className="h-3.5 w-3.5" />
                    {view.label}
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl"
              style={{
                background: "hsl(0 0% 100%)",
                border: "1px solid hsl(220 13% 91%)",
                boxShadow: "0 1px 2px 0 hsl(220 13% 90% / 0.3)",
              }}>
              {/* Card header */}
              <div className="flex items-center gap-3 px-5 py-4"
                style={{ borderBottom: "1px solid hsl(220 13% 93%)" }}>
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
                    style={{ color: "hsl(220 8% 55%)" }} />
                  <Input placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9 text-sm border-0 shadow-none focus-visible:ring-1"
                    style={{ background: "hsl(220 14% 96%)", color: "hsl(222 20% 15%)" }} />
                </div>
                <div className="flex-1" />
                {(taxonomyView === "outline" || taxonomyView === "main") && (
                  <Button onClick={() => openAdd({ type: "mainCategory" })} size="sm"
                    className="h-9 gap-1.5 text-[13px] font-medium shadow-sm"
                    style={{ background: "hsl(224 72% 45%)", color: "white" }}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Main Category
                  </Button>
                )}
                {taxonomyView === "sub" && (
                  <Button onClick={() => openAdd({ type: "subCategory" })} size="sm"
                    disabled={mainCategories.length === 0}
                    className="h-9 gap-1.5 text-[13px] font-medium shadow-sm"
                    style={{ background: "hsl(224 72% 45%)", color: "white" }}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Sub Category
                  </Button>
                )}
                {taxonomyView === "workType" && (
                  <Button onClick={() => openAdd({ type: "workType" })} size="sm"
                    disabled={parentGroups.every((g) => g.items.length === 0)}
                    className="h-9 gap-1.5 text-[13px] font-medium shadow-sm"
                    style={{ background: "hsl(224 72% 45%)", color: "white" }}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Work Type
                  </Button>
                )}
              </div>

              {taxonomyView === "outline" && (
                <TaxonomyOutline
                  outlineSections={outlineSections}
                  searchActive={searchActive}
                  collapsed={collapsed}
                  onToggleCollapsed={toggleCollapsed}
                  onOpenEdit={(kind, name) => setEditTarget({ kind, name } as EditTarget)}
                  onDetachWorkType={(wtName, parent) => {
                    const wt = workTypes.find((w) => w.name === wtName);
                    if (!wt) return;
                    const next = wt.parents.filter((p) => p !== parent);
                    setWorkTypeParents(wtName, next);
                    toast.success(`"${wtName}" removed from "${parent}".`);
                  }}
                  onAddSubCategory={(parentMain) => openAdd({ type: "subCategory", parentMain })}
                  onAddWorkType={(parentName) => openAdd({ type: "workType", parentName })}
                  onDeleteMain={(name) => {
                    const subCount = subCategoriesForMain(name).length;
                    const workTypeCount = workTypes.filter((w) => w.parents.includes(name)).length;
                    setDeleteTarget({ type: "mainCategory", name, subCount, workTypeCount });
                  }}
                  onDeleteSub={(name) => {
                    const wtCount = workTypes.filter((w) => w.parents.includes(name)).length;
                    setDeleteTarget({ type: "subCategory", name, workTypeCount: wtCount });
                  }}
                />
              )}

              {taxonomyView === "main" && (
                <MainCategoriesTable
                  rows={pagedMain} totalRows={sortedMainCategories.length}
                  page={mainPage} onPageChange={setMainPage}
                  sort={mainSort} onSortChange={setMainSort}
                  subCategoriesForMain={subCategoriesForMain} workTypes={workTypes}
                  onOpenEdit={(name) => setEditTarget({ kind: "mainCategory", name })}
                  onDelete={(name) => {
                    const subCount = subCategoriesForMain(name).length;
                    const workTypeCount = workTypes.filter((w) => w.parents.includes(name)).length;
                    setDeleteTarget({ type: "mainCategory", name, subCount, workTypeCount });
                  }}
                />
              )}

              {taxonomyView === "sub" && (
                <SubCategoriesTable
                  rows={pagedSub} totalRows={sortedSubCategories.length}
                  page={subPage} onPageChange={setSubPage}
                  sort={subSort} onSortChange={setSubSort}
                  workTypes={workTypes}
                  onOpenEdit={(name) => setEditTarget({ kind: "subCategory", name })}
                  onDelete={(name) => {
                    const wtCount = workTypes.filter((w) => w.parents.includes(name)).length;
                    setDeleteTarget({ type: "subCategory", name, workTypeCount: wtCount });
                  }}
                />
              )}

              {taxonomyView === "workType" && (
                <WorkTypesTable
                  rows={pagedWorkType} totalRows={sortedWorkTypes.length}
                  page={wtPage} onPageChange={setWtPage}
                  sort={wtSort} onSortChange={setWtSort}
                  onOpenEdit={(name) => setEditTarget({ kind: "workType", name })}
                  onDelete={(name) => {
                    const wt = workTypes.find((w) => w.name === name);
                    setDeleteTarget({ type: "workType", name, parentCount: wt?.parents.length ?? 0 });
                  }}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === "ai" && <AISettingsPanel />}

        {activeTab === "email" && <EmailSettingsConfig />}

        {activeTab === "inference" && (
          <div className="rounded-xl p-6" style={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(220 13% 91%)" }}>
            <InferenceRulesEditor />
          </div>
        )}
      </div>

      {/* Add dialog (simple adds: team, client, main category) */}
      {addCtx && (addCtx.type === "team" || addCtx.type === "client" || addCtx.type === "mainCategory") && (
        <SimpleAddDialog
          open
          kind={addCtx.type}
          onClose={closeAdd}
          onSubmit={handleSimpleAdd}
        />
      )}

      {/* Sub category add — still simple (create new only, per user decision) */}
      {addCtx?.type === "subCategory" && (
        <SubCategoryAddDialog
          open
          preselectedParent={addCtx.parentMain}
          mainCategories={mainCategories}
          onClose={closeAdd}
          onSubmit={(name, parent) => {
            addSubCategory(name, parent);
            toast.success(`Sub category added under ${parent}.`);
            closeAdd();
          }}
        />
      )}

      {/* Work type add — two-mode dialog (attach existing / create new) */}
      {addCtx?.type === "workType" && (
        <WorkTypeAddDialog
          open
          preselectedParent={addCtx.parentName}
          workTypes={workTypes}
          parentGroups={parentGroups}
          onClose={closeAdd}
          onAttachExisting={(names, parent) => {
            for (const name of names) {
              const wt = workTypes.find((w) => w.name === name);
              if (!wt || wt.parents.includes(parent)) continue;
              setWorkTypeParents(name, [...wt.parents, parent]);
            }
            toast.success(
              `Attached ${names.length} ${names.length === 1 ? "work type" : "work types"} to ${parent}.`,
            );
            closeAdd();
          }}
          onCreateNew={(name, parents) => {
            if (parents.length === 0) {
              toast.error("Pick at least one parent.");
              return;
            }
            addWorkType(name, parents);
            toast.success("Work type created.");
            closeAdd();
          }}
        />
      )}

      {/* Edit dialogs */}
      {editTarget && (
        <EditDialog
          target={editTarget}
          cc={cc}
          onTeamRename={(oldName, newName) => {
            cascadeRenameTeam(oldName, newName);
            setEditTarget(null);
          }}
          onClientRename={(oldName, newName) => {
            cascadeRenameClient(oldName, newName);
            setEditTarget(null);
          }}
          onMainRename={(oldName, newName) => {
            renameMainCategory(oldName, newName);
            toast.success("Renamed. Cascades applied.");
            setEditTarget({ kind: "mainCategory", name: newName });
          }}
          onSubRename={(oldName, newName) => {
            renameSubCategory(oldName, newName);
            toast.success("Renamed. Work type parents updated.");
            setEditTarget({ kind: "subCategory", name: newName });
          }}
          onWorkTypeRename={(oldName, newName) => {
            renameWorkType(oldName, newName);
            toast.success("Renamed.");
            setEditTarget({ kind: "workType", name: newName });
          }}
          onWorkTypeParentsChange={(name, parents) => {
            setWorkTypeParents(name, parents);
            toast.success("Parents updated.");
          }}
          onAddSubUnder={(parentMain) => {
            setEditTarget(null);
            openAdd({ type: "subCategory", parentMain });
          }}
          onAddWorkTypeUnder={(parentName) => {
            setEditTarget(null);
            openAdd({ type: "workType", parentName });
          }}
          onDeleteSub={(name) => {
            const wtCount = workTypes.filter((w) => w.parents.includes(name)).length;
            setDeleteTarget({ type: "subCategory", name, workTypeCount: wtCount });
          }}
          onDetachWorkType={(wtName, parent) => {
            const wt = workTypes.find((w) => w.name === wtName);
            if (!wt) return;
            setWorkTypeParents(wtName, wt.parents.filter((p) => p !== parent));
            toast.success(`"${wtName}" removed from "${parent}".`);
          }}
          onDeleteSelf={() => {
            // Open delete confirm for the current edit target.
            const t = editTarget;
            if (!t) return;
            if (t.kind === "team") setDeleteTarget({ type: "team", name: t.name });
            else if (t.kind === "client") setDeleteTarget({ type: "client", name: t.name });
            else if (t.kind === "mainCategory") {
              const subCount = subCategoriesForMain(t.name).length;
              const workTypeCount = workTypes.filter((w) => w.parents.includes(t.name)).length;
              setDeleteTarget({ type: "mainCategory", name: t.name, subCount, workTypeCount });
            } else if (t.kind === "subCategory") {
              const wtCount = workTypes.filter((w) => w.parents.includes(t.name)).length;
              setDeleteTarget({ type: "subCategory", name: t.name, workTypeCount: wtCount });
            } else if (t.kind === "workType") {
              const wt = workTypes.find((w) => w.name === t.name);
              setDeleteTarget({ type: "workType", name: t.name, parentCount: wt?.parents.length ?? 0 });
            }
          }}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm pt-1">
                {deleteTarget?.type === "mainCategory" && (deleteTarget.subCount > 0 || deleteTarget.workTypeCount > 0) && (
                  <div className="rounded-md px-3 py-2 text-[13px]"
                    style={{ background: "hsl(38 92% 95%)", border: "1px solid hsl(38 92% 85%)", color: "hsl(24 70% 30%)" }}>
                    Cascades to <span className="font-semibold">{deleteTarget.subCount} sub {deleteTarget.subCount === 1 ? "category" : "categories"}</span> and strips <span className="font-semibold">{deleteTarget.workTypeCount} work {deleteTarget.workTypeCount === 1 ? "type" : "types"}</span> of this parent.
                  </div>
                )}
                {deleteTarget?.type === "subCategory" && deleteTarget.workTypeCount > 0 && (
                  <div className="rounded-md px-3 py-2 text-[13px]"
                    style={{ background: "hsl(38 92% 95%)", border: "1px solid hsl(38 92% 85%)", color: "hsl(24 70% 30%)" }}>
                    Strips <span className="font-semibold">{deleteTarget.workTypeCount} work {deleteTarget.workTypeCount === 1 ? "type" : "types"}</span> of this parent. The work types themselves stay.
                  </div>
                )}
                {deleteTarget?.type === "workType" && deleteTarget.parentCount > 1 && (
                  <div className="rounded-md px-3 py-2 text-[13px]"
                    style={{ background: "hsl(38 92% 95%)", border: "1px solid hsl(38 92% 85%)", color: "hsl(24 70% 30%)" }}>
                    Removes this work type from <span className="font-semibold">{deleteTarget.parentCount} parents</span>.
                  </div>
                )}
                <span style={{ color: "hsl(220 10% 45%)" }}>This action cannot be undone.</span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} size="sm">Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete} size="sm">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// =====================================================================
// SimpleGridCard — Teams / Clients
// =====================================================================

interface SimpleGridCardProps {
  items: readonly string[];
  totalCount: number;
  search: string;
  onSearch: (q: string) => void;
  searchPlaceholder: string;
  addLabel: string;
  onAdd: () => void;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
  emptyText: string;
}

const SimpleGridCard = ({
  items, totalCount, search, onSearch, searchPlaceholder,
  addLabel, onAdd, onEdit, onDelete, emptyText,
}: SimpleGridCardProps) => (
  <div className="rounded-xl"
    style={{
      background: "hsl(0 0% 100%)",
      border: "1px solid hsl(220 13% 91%)",
      boxShadow: "0 1px 2px 0 hsl(220 13% 90% / 0.3)",
    }}>
    <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid hsl(220 13% 93%)" }}>
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "hsl(220 8% 55%)" }} />
        <Input placeholder={searchPlaceholder} value={search} onChange={(e) => onSearch(e.target.value)}
          className="pl-9 h-9 text-sm border-0 shadow-none focus-visible:ring-1"
          style={{ background: "hsl(220 14% 96%)", color: "hsl(222 20% 15%)" }} />
      </div>
      <div className="flex-1" />
      <Button onClick={onAdd} size="sm" className="h-9 gap-1.5 text-[13px] font-medium shadow-sm"
        style={{ background: "hsl(224 72% 45%)", color: "white" }}>
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
    <div className="p-5">
      {items.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-sm" style={{ color: "hsl(220 10% 50%)" }}>
          {totalCount === 0 ? emptyText : "No matches."}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {items.map((name) => (
            <div key={name}
              className="glass-card rounded-xl p-3 flex items-center justify-between hover:shadow-md transition-shadow group">
              <span className="font-medium text-sm truncate pr-2" style={{ color: "hsl(222 20% 15%)" }}>{name}</span>
              <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onEdit(name)} aria-label={`Edit ${name}`}
                  className="p-1.5 rounded hover:bg-muted transition-colors"
                  style={{ color: "hsl(220 10% 45%)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "hsl(222 20% 15%)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "hsl(220 10% 45%)")}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onDelete(name)} aria-label={`Delete ${name}`}
                  className="p-1.5 rounded hover:bg-destructive/10 text-destructive/60 hover:text-destructive transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

// =====================================================================
// Outline view (same as Turn 5 final, unchanged)
// =====================================================================

interface TaxonomyOutlineProps {
  outlineSections: {
    main: string;
    directWorkTypes: WorkType[];
    subSections: { sub: SubCategory; workTypes: WorkType[] }[];
    totalWorkTypeCount: number;
    subCount: number;
    include: boolean;
  }[];
  searchActive: boolean;
  collapsed: Set<string>;
  onToggleCollapsed: (main: string) => void;
  onOpenEdit: (kind: "mainCategory" | "subCategory" | "workType", name: string) => void;
  onDetachWorkType: (workTypeName: string, parentToRemove: string) => void;
  onAddSubCategory: (parentMain: string) => void;
  onAddWorkType: (parentName: string) => void;
  onDeleteMain: (name: string) => void;
  onDeleteSub: (name: string) => void;
}

const TaxonomyOutline = ({
  outlineSections, searchActive, collapsed, onToggleCollapsed,
  onOpenEdit, onDetachWorkType, onAddSubCategory, onAddWorkType, onDeleteMain, onDeleteSub,
}: TaxonomyOutlineProps) => {
  const visibleSections = outlineSections.filter((s) => s.include);

  if (outlineSections.length === 0) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: "hsl(220 10% 50%)" }}>
        No main categories yet. Use "Add Main Category" above.
      </div>
    );
  }
  if (visibleSections.length === 0 && searchActive) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: "hsl(220 10% 50%)" }}>
        No matches.
      </div>
    );
  }

  return (
    <div>
      {visibleSections.map((section, idx) => (
        <MainCategoryBlock key={section.main}
          section={section} isFirst={idx === 0}
          isCollapsed={!searchActive && collapsed.has(section.main)}
          onToggleCollapsed={() => onToggleCollapsed(section.main)}
          onOpenEdit={onOpenEdit}
          onDetachWorkType={onDetachWorkType}
          onAddSubCategory={onAddSubCategory}
          onAddWorkType={onAddWorkType}
          onDeleteMain={onDeleteMain}
          onDeleteSub={onDeleteSub}
        />
      ))}
    </div>
  );
};

interface MainCategoryBlockProps {
  section: TaxonomyOutlineProps["outlineSections"][number];
  isFirst: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenEdit: TaxonomyOutlineProps["onOpenEdit"];
  onDetachWorkType: TaxonomyOutlineProps["onDetachWorkType"];
  onAddSubCategory: TaxonomyOutlineProps["onAddSubCategory"];
  onAddWorkType: TaxonomyOutlineProps["onAddWorkType"];
  onDeleteMain: TaxonomyOutlineProps["onDeleteMain"];
  onDeleteSub: TaxonomyOutlineProps["onDeleteSub"];
}

const MainCategoryBlock = ({
  section, isFirst, isCollapsed, onToggleCollapsed,
  onOpenEdit, onDetachWorkType, onAddSubCategory, onAddWorkType, onDeleteMain, onDeleteSub,
}: MainCategoryBlockProps) => {
  const { main, directWorkTypes, subSections, totalWorkTypeCount, subCount } = section;
  return (
    <section style={{ borderTop: isFirst ? "none" : "1px solid hsl(220 13% 93%)" }}>
      <div className="group flex items-start gap-3 px-5 pt-5 pb-3">
        <button onClick={onToggleCollapsed} aria-label={isCollapsed ? `Expand ${main}` : `Collapse ${main}`}
          className="flex items-center justify-center w-5 h-5 rounded mt-2 transition-transform shrink-0"
          style={{ color: "hsl(220 10% 45%)" }}>
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
          style={{ background: "hsl(224 72% 95%)", color: "hsl(224 72% 35%)" }}>
          <Layers className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <button onClick={() => onOpenEdit("mainCategory", main)}
              className="text-[17px] font-semibold tracking-tight"
              style={{ color: "hsl(222 20% 15%)" }}>
              {main}
            </button>
            <span className="text-[12px] tabular-nums" style={{ color: "hsl(220 10% 50%)" }}>
              {subCount > 0 && `${subCount} sub ${subCount === 1 ? "cat" : "cats"}`}
              {subCount > 0 && totalWorkTypeCount > 0 && " · "}
              {totalWorkTypeCount > 0 && `${totalWorkTypeCount} work ${totalWorkTypeCount === 1 ? "type" : "types"}`}
              {subCount === 0 && totalWorkTypeCount === 0 && "empty"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton onClick={() => onOpenEdit("mainCategory", main)} label={`Edit ${main}`} variant="neutral">
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton onClick={() => onDeleteMain(main)} label={`Delete ${main}`} variant="danger">
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
      {!isCollapsed && (
        <>
          {directWorkTypes.length > 0 && (
            <div className="px-5 pb-3 pl-[88px]">
              <WorkTypeChipRow workTypes={directWorkTypes} parentName={main}
                onClick={(wt) => onOpenEdit("workType", wt.name)}
                onDetach={onDetachWorkType}
              />
            </div>
          )}
          {subSections.map(({ sub, workTypes: subWTs }) => (
            <div key={sub.name} className="group relative pl-[88px] pr-5 pb-3">
              <div className="absolute top-0 bottom-0 w-[2px]"
                style={{ left: "56px", background: "hsl(224 72% 92%)" }} />
              <div className="flex items-start gap-2 pt-2 pb-1.5">
                <button onClick={() => onOpenEdit("subCategory", sub.name)}
                  className="text-[13px] font-semibold tracking-tight uppercase"
                  style={{ color: "hsl(224 72% 35%)", letterSpacing: "0.03em" }}>
                  {sub.name}
                </button>
                <span className="text-[11px] tabular-nums mt-0.5" style={{ color: "hsl(220 10% 55%)" }}>
                  {subWTs.length > 0 ? `${subWTs.length} work ${subWTs.length === 1 ? "type" : "types"}` : "no work types"}
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconButton onClick={() => onOpenEdit("subCategory", sub.name)} label={`Edit ${sub.name}`} variant="neutral" size="sm">
                    <Pencil className="h-3 w-3" />
                  </IconButton>
                  <IconButton onClick={() => onDeleteSub(sub.name)} label={`Delete ${sub.name}`} variant="danger" size="sm">
                    <Trash2 className="h-3 w-3" />
                  </IconButton>
                </div>
              </div>
              {subWTs.length > 0 && (
                <WorkTypeChipRow workTypes={subWTs} parentName={sub.name}
                  onClick={(wt) => onOpenEdit("workType", wt.name)}
                  onDetach={onDetachWorkType}
                />
              )}
              <div className="mt-1.5">
                <GhostAddButton onClick={() => onAddWorkType(sub.name)} label="Add work type" small />
              </div>
            </div>
          ))}
          {subCount === 0 && (
            <div className="px-5 pb-4 pl-[88px]">
              <GhostAddButton onClick={() => onAddWorkType(main)} label="Add work type" small />
            </div>
          )}
          <div className="px-5 pb-5 pl-[88px]">
            <GhostAddButton onClick={() => onAddSubCategory(main)}
              label={subCount === 0 ? "Add sub category" : "Add another sub category"}
              small muted />
          </div>
        </>
      )}
    </section>
  );
};

// =====================================================================
// Flat tables (copied verbatim from Turn 5 — structure unchanged)
// =====================================================================

interface MainCategoriesTableProps {
  rows: readonly string[]; totalRows: number;
  page: number; onPageChange: (p: number) => void;
  sort: { col: "name" | "subs" | "types"; dir: SortDirection };
  onSortChange: (s: { col: "name" | "subs" | "types"; dir: SortDirection }) => void;
  subCategoriesForMain: (main: string) => readonly SubCategory[];
  workTypes: readonly WorkType[];
  onOpenEdit: (name: string) => void;
  onDelete: (name: string) => void;
}

const MainCategoriesTable = ({
  rows, totalRows, page, onPageChange, sort, onSortChange,
  subCategoriesForMain, workTypes, onOpenEdit, onDelete,
}: MainCategoriesTableProps) => {
  if (totalRows === 0) return <EmptyTableState message="No main categories yet." />;
  return (
    <div>
      <div className="grid grid-cols-[1fr_120px_120px_80px] gap-4 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
        style={{ background: "hsl(220 14% 97%)", borderBottom: "1px solid hsl(220 13% 91%)", color: "hsl(220 10% 45%)" }}>
        <SortHeader label="Name" active={sort.col === "name"} dir={sort.dir}
          onClick={() => toggleSort(sort, "name", onSortChange)} />
        <SortHeader label="Sub Cats" active={sort.col === "subs"} dir={sort.dir}
          onClick={() => toggleSort(sort, "subs", onSortChange)} align="right" />
        <SortHeader label="Work Types" active={sort.col === "types"} dir={sort.dir}
          onClick={() => toggleSort(sort, "types", onSortChange)} align="right" />
        <span></span>
      </div>
      <ul className="divide-y" style={{ borderColor: "hsl(220 13% 94%)" }}>
        {rows.map((name) => {
          const subCount = subCategoriesForMain(name).length;
          const wtCount = workTypes.filter((w) => w.parents.includes(name)).length;
          return (
            <li key={name} className="group grid grid-cols-[1fr_120px_120px_80px] items-center gap-4 px-5 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
                  style={{ background: "hsl(224 72% 95%)", color: "hsl(224 72% 35%)" }}>
                  <Folder className="h-3.5 w-3.5" />
                </div>
                <button onClick={() => onOpenEdit(name)}
                  className="text-[14px] font-medium truncate text-left"
                  style={{ color: "hsl(222 20% 15%)" }}>
                  {name}
                </button>
              </div>
              <span className="text-[13px] text-right tabular-nums"
                style={{ color: subCount > 0 ? "hsl(222 20% 30%)" : "hsl(220 8% 60%)" }}>{subCount}</span>
              <span className="text-[13px] text-right tabular-nums"
                style={{ color: wtCount > 0 ? "hsl(222 20% 30%)" : "hsl(220 8% 60%)" }}>{wtCount}</span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                <IconButton onClick={() => onOpenEdit(name)} label={`Edit ${name}`} variant="neutral"><Pencil className="h-3.5 w-3.5" /></IconButton>
                <IconButton onClick={() => onDelete(name)} label={`Delete ${name}`} variant="danger"><Trash2 className="h-3.5 w-3.5" /></IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      <PaginationFooter page={page} onPageChange={onPageChange} totalItems={totalRows} />
    </div>
  );
};

const SubCategoryRow = ({
  sub, workTypes, onOpenEdit, onDelete,
}: {
  sub: SubCategory;
  workTypes: readonly WorkType[];
  onOpenEdit: (name: string) => void;
  onDelete: (name: string) => void;
}) => {
  const cc = useClientsConfig();
  const [open, setOpen] = useState(false);
  const [assigned, setAssigned] = useState<string[]>(sub.clients ?? []);

  useEffect(() => { setAssigned(sub.clients ?? []); }, [sub.clients]);

  const wtCount = workTypes.filter((w) => w.parents.includes(sub.name)).length;

  const toggleClient = (client: string) => {
    const next = assigned.includes(client)
      ? assigned.filter((c) => c !== client)
      : [...assigned, client];
    setAssigned(next);
    cc.setSubCategoryClients(sub.name, next);
  };

  return (
    <li className="group grid grid-cols-[1fr_1fr_120px_112px] items-center gap-4 px-5 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
          style={{ background: "hsl(224 72% 95%)", color: "hsl(224 72% 35%)" }}>
          <Layers className="h-3.5 w-3.5" />
        </div>
        <button onClick={() => onOpenEdit(sub.name)}
          className="text-[14px] font-medium truncate text-left"
          style={{ color: "hsl(222 20% 15%)" }}>
          {sub.name}
        </button>
      </div>
      <span className="text-[13px] truncate" style={{ color: "hsl(222 20% 30%)" }}>{sub.parentMainCategory}</span>
      <span className="text-[13px] text-right tabular-nums"
        style={{ color: wtCount > 0 ? "hsl(222 20% 30%)" : "hsl(220 8% 60%)" }}>{wtCount}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Assign clients to ${sub.name}`}
              title={`Assign clients to ${sub.name}`}
              className="flex items-center justify-center rounded-md transition-colors w-7 h-7"
              style={{ color: "hsl(224 50% 50%)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(224 72% 95%)"; e.currentTarget.style.color = "hsl(224 72% 40%)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "hsl(224 50% 50%)"; }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="end">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5"
              style={{ borderBottom: "1px solid hsl(220 13% 91%)" }}>
              <h4 className="text-sm font-medium leading-none">Assign Clients</h4>
              <span className="text-[11px]" style={{ color: "hsl(220 10% 50%)" }}>
                {assigned.length} of {cc.clients.length} selected
              </span>
            </div>

            {cc.clients.length === 0 ? (
              <p className="px-3 py-3 text-[12px]" style={{ color: "hsl(220 10% 55%)" }}>
                No clients configured yet.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto py-1">
                {[...cc.clients].sort().map((client) => {
                  const isAssigned = assigned.includes(client);
                  return (
                    <button
                      key={client}
                      type="button"
                      onClick={() => toggleClient(client)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors"
                      style={{ color: "hsl(222 20% 15%)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 14% 96%)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors"
                        style={{
                          background: isAssigned ? "hsl(224 72% 45%)" : "transparent",
                          border: isAssigned ? "1px solid hsl(224 72% 45%)" : "1px solid hsl(220 13% 80%)",
                          color: "hsl(0 0% 100%)",
                        }}>
                        {isAssigned && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </div>
                      <Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(220 10% 50%)" }} />
                      <span className="font-medium">{client}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <IconButton onClick={() => onOpenEdit(sub.name)} label={`Edit ${sub.name}`} variant="neutral">
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={() => onDelete(sub.name)} label={`Delete ${sub.name}`} variant="danger">
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </li>
  );
};

interface SubCategoriesTableProps {
  rows: readonly SubCategory[]; totalRows: number;
  page: number; onPageChange: (p: number) => void;
  sort: { col: "name" | "parent" | "types"; dir: SortDirection };
  onSortChange: (s: { col: "name" | "parent" | "types"; dir: SortDirection }) => void;
  workTypes: readonly WorkType[];
  onOpenEdit: (name: string) => void;
  onDelete: (name: string) => void;
}

const SubCategoriesTable = ({
  rows, totalRows, page, onPageChange, sort, onSortChange,
  workTypes, onOpenEdit, onDelete,
}: SubCategoriesTableProps) => {
  if (totalRows === 0) return <EmptyTableState message="No sub categories yet." />;
  return (
    <div>
      <div className="grid grid-cols-[1fr_1fr_120px_112px] gap-4 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
        style={{ background: "hsl(220 14% 97%)", borderBottom: "1px solid hsl(220 13% 91%)", color: "hsl(220 10% 45%)" }}>
        <SortHeader label="Name" active={sort.col === "name"} dir={sort.dir} onClick={() => toggleSort(sort, "name", onSortChange)} />
        <SortHeader label="Parent" active={sort.col === "parent"} dir={sort.dir} onClick={() => toggleSort(sort, "parent", onSortChange)} />
        <SortHeader label="Work Types" active={sort.col === "types"} dir={sort.dir} onClick={() => toggleSort(sort, "types", onSortChange)} align="right" />
        <span></span>
      </div>
      <ul className="divide-y" style={{ borderColor: "hsl(220 13% 94%)" }}>
        {rows.map((sub) => (
          <SubCategoryRow
            key={sub.name}
            sub={sub}
            workTypes={workTypes}
            onOpenEdit={onOpenEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
      <PaginationFooter page={page} onPageChange={onPageChange} totalItems={totalRows} />
    </div>
  );
};

interface WorkTypesTableProps {
  rows: readonly WorkType[]; totalRows: number;
  page: number; onPageChange: (p: number) => void;
  sort: { col: "name" | "parents"; dir: SortDirection };
  onSortChange: (s: { col: "name" | "parents"; dir: SortDirection }) => void;
  onOpenEdit: (name: string) => void;
  onDelete: (name: string) => void;
}

const WorkTypesTable = ({
  rows, totalRows, page, onPageChange, sort, onSortChange, onOpenEdit, onDelete,
}: WorkTypesTableProps) => {
  if (totalRows === 0) return <EmptyTableState message="No work types yet." />;
  return (
    <div>
      <div className="grid grid-cols-[1fr_1.5fr_80px] gap-4 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
        style={{ background: "hsl(220 14% 97%)", borderBottom: "1px solid hsl(220 13% 91%)", color: "hsl(220 10% 45%)" }}>
        <SortHeader label="Name" active={sort.col === "name"} dir={sort.dir} onClick={() => toggleSort(sort, "name", onSortChange)} />
        <SortHeader label="Parents" active={sort.col === "parents"} dir={sort.dir} onClick={() => toggleSort(sort, "parents", onSortChange)} />
        <span></span>
      </div>
      <ul className="divide-y" style={{ borderColor: "hsl(220 13% 94%)" }}>
        {rows.map((wt) => (
          <li key={wt.name} className="group grid grid-cols-[1fr_1.5fr_80px] items-center gap-4 px-5 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
                style={{ background: "hsl(220 14% 95%)", color: "hsl(220 10% 40%)" }}>
                <Wrench className="h-3.5 w-3.5" />
              </div>
              <button onClick={() => onOpenEdit(wt.name)}
                className="text-[14px] font-medium truncate text-left"
                style={{ color: "hsl(222 20% 15%)" }}>
                {wt.name}
              </button>
              {wt.parents.length > 1 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 rounded shrink-0"
                  style={{ background: "hsl(224 72% 95%)", color: "hsl(224 72% 35%)" }}
                  title="Shared across parents">
                  <Link2 className="h-2.5 w-2.5" />
                  shared
                </span>
              )}
            </div>
            <div className="min-w-0">
              <ParentChips parents={wt.parents} />
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
              <IconButton onClick={() => onOpenEdit(wt.name)} label={`Edit ${wt.name}`} variant="neutral"><Pencil className="h-3.5 w-3.5" /></IconButton>
              <IconButton onClick={() => onDelete(wt.name)} label={`Delete ${wt.name}`} variant="danger"><Trash2 className="h-3.5 w-3.5" /></IconButton>
            </div>
          </li>
        ))}
      </ul>
      <PaginationFooter page={page} onPageChange={onPageChange} totalItems={totalRows} />
    </div>
  );
};

// =====================================================================
// Add dialogs
// =====================================================================

const SimpleAddDialog = ({
  open, kind, onClose, onSubmit,
}: { open: boolean; kind: "team" | "client" | "mainCategory"; onClose: () => void; onSubmit: (name: string) => void }) => {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  const labels = {
    team: "New Team",
    client: "New Client",
    mainCategory: "New Main Category",
  };
  const submit = () => {
    const t = name.trim();
    if (!t) { toast.error("Name is required."); return; }
    onSubmit(t);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">{labels[kind]}</DialogTitle>
          <DialogDescription className="text-sm">Give it a unique name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 pt-2">
          <Label htmlFor="simple-add-name" className="text-xs font-medium">Name</Label>
          <Input id="simple-add-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={submit} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const SubCategoryAddDialog = ({
  open, preselectedParent, mainCategories, onClose, onSubmit,
}: {
  open: boolean; preselectedParent?: string; mainCategories: readonly string[];
  onClose: () => void; onSubmit: (name: string, parent: string) => void;
}) => {
  const [name, setName] = useState("");
  const [parent, setParent] = useState(preselectedParent ?? "");
  useEffect(() => { if (open) { setName(""); setParent(preselectedParent ?? ""); } }, [open, preselectedParent]);
  const submit = () => {
    const t = name.trim();
    if (!t) { toast.error("Name is required."); return; }
    if (!parent) { toast.error("Pick a parent main category."); return; }
    onSubmit(t, parent);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">New Sub Category</DialogTitle>
          <DialogDescription className="text-sm">
            {preselectedParent
              ? <>This sub category will nest under <span className="font-medium" style={{ color: "hsl(222 20% 15%)" }}>{preselectedParent}</span>.</>
              : "Sub categories nest work types under a main category."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          {!preselectedParent && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Parent main category</Label>
              <Select value={parent} onValueChange={setParent}>
                <SelectTrigger><SelectValue placeholder="Select main category…" /></SelectTrigger>
                <SelectContent>
                  {mainCategories.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={submit} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Work Type add dialog — two modes:
 *   - Attach existing: multi-select of work types not yet attached to
 *     the preselected parent, appends parent to their `parents[]`
 *   - Create new: traditional name + extra parents form
 *
 * Only shows the toggle when a preselectedParent is given. When no
 * parent is preselected (adding from the flat Work Types view),
 * only Create new makes sense because there's no implicit parent
 * to attach to.
 */
const WorkTypeAddDialog = ({
  open, preselectedParent, workTypes, parentGroups, onClose, onAttachExisting, onCreateNew,
}: {
  open: boolean;
  preselectedParent?: string;
  workTypes: readonly WorkType[];
  parentGroups: { main: string; items: string[]; hasSubs: boolean }[];
  onClose: () => void;
  onAttachExisting: (names: string[], parent: string) => void;
  onCreateNew: (name: string, parents: string[]) => void;
}) => {
  const [mode, setMode] = useState<"attach" | "create">(
    preselectedParent ? "attach" : "create",
  );
  const [selectedExisting, setSelectedExisting] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [extraParents, setExtraParents] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setMode(preselectedParent ? "attach" : "create");
      setSelectedExisting([]);
      setNewName("");
      setExtraParents([]);
    }
  }, [open, preselectedParent]);

  // Work types not already attached to the preselected parent.
  const attachableWorkTypes = useMemo(() => {
    if (!preselectedParent) return [];
    return workTypes.filter((w) => !w.parents.includes(preselectedParent));
  }, [workTypes, preselectedParent]);

  const toggleExisting = (name: string) => {
    setSelectedExisting((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const submit = () => {
    if (mode === "attach") {
      if (!preselectedParent) return;
      if (selectedExisting.length === 0) {
        toast.error("Select at least one work type to attach.");
        return;
      }
      onAttachExisting(selectedExisting, preselectedParent);
    } else {
      const t = newName.trim();
      if (!t) { toast.error("Name is required."); return; }
      const parents = preselectedParent ? [preselectedParent, ...extraParents] : extraParents;
      onCreateNew(t, parents);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {preselectedParent ? `Add Work Type to ${preselectedParent}` : "New Work Type"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {preselectedParent
              ? "Attach an existing work type, or create a new one."
              : "Assign one or more parents."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle (only if a parent is preselected — attach mode needs it) */}
        {preselectedParent && (
          <div className="inline-flex items-center gap-0.5 p-1 rounded-lg self-start"
            style={{ background: "hsl(220 14% 95%)", border: "1px solid hsl(220 13% 91%)" }}>
            <button onClick={() => setMode("attach")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all"
              style={{
                background: mode === "attach" ? "hsl(0 0% 100%)" : "transparent",
                color: mode === "attach" ? "hsl(222 20% 15%)" : "hsl(220 10% 45%)",
                boxShadow: mode === "attach" ? "0 1px 2px 0 hsl(220 13% 85% / 0.5), 0 0 0 1px hsl(220 13% 88%)" : "none",
              }}>
              Attach existing
              {attachableWorkTypes.length > 0 && (
                <span className="text-[11px] ml-0.5 tabular-nums" style={{ color: "hsl(220 8% 55%)" }}>
                  {attachableWorkTypes.length}
                </span>
              )}
            </button>
            <button onClick={() => setMode("create")}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all"
              style={{
                background: mode === "create" ? "hsl(0 0% 100%)" : "transparent",
                color: mode === "create" ? "hsl(222 20% 15%)" : "hsl(220 10% 45%)",
                boxShadow: mode === "create" ? "0 1px 2px 0 hsl(220 13% 85% / 0.5), 0 0 0 1px hsl(220 13% 88%)" : "none",
              }}>
              Create new
            </button>
          </div>
        )}

        <div className="space-y-4 pt-1">
          {mode === "attach" && preselectedParent && (
            <>
              {attachableWorkTypes.length === 0 ? (
                <p className="text-sm py-6 text-center" style={{ color: "hsl(220 10% 50%)" }}>
                  All work types are already attached to {preselectedParent}.
                </p>
              ) : (
                <div className="max-h-[280px] overflow-y-auto rounded-md"
                  style={{ border: "1px solid hsl(220 13% 91%)" }}>
                  <ul className="divide-y" style={{ borderColor: "hsl(220 13% 94%)" }}>
                    {attachableWorkTypes.map((wt) => {
                      const selected = selectedExisting.includes(wt.name);
                      return (
                        <li key={wt.name}>
                          <button onClick={() => toggleExisting(wt.name)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors"
                            style={{ color: "hsl(222 20% 15%)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 14% 96%)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                            <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                              style={{
                                background: selected ? "hsl(224 72% 45%)" : "transparent",
                                border: selected ? "1px solid hsl(224 72% 45%)" : "1px solid hsl(220 13% 85%)",
                                color: "hsl(0 0% 100%)",
                              }}>
                              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                            </div>
                            <span className="flex-1 font-medium">{wt.name}</span>
                            {wt.parents.length > 0 && (
                              <span className="text-[11px]" style={{ color: "hsl(220 10% 55%)" }}>
                                currently in {wt.parents.length}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <p className="text-[11px]" style={{ color: "hsl(220 10% 50%)" }}>
                {selectedExisting.length === 0
                  ? "Select work types to attach to this parent."
                  : `${selectedExisting.length} selected. They'll keep their existing parents and add ${preselectedParent}.`}
              </p>
            </>
          )}

          {mode === "create" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                  onKeyDown={(e) => e.key === "Enter" && submit()} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {preselectedParent ? "Also attach to (optional)" : "Parents"}
                </Label>
                <ParentsMultiSelect
                  parentGroups={parentGroups.map((g) => ({
                    ...g,
                    items: g.items.filter((i) => i !== preselectedParent),
                  }))}
                  selected={extraParents}
                  onChange={setExtraParents}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={submit} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>
            {mode === "attach" ? "Attach" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// =====================================================================
// EditDialog — dispatches to the right body based on target.kind
// =====================================================================

type ClientsConfigFull = ReturnType<typeof useClientsConfig>;

interface EditDialogProps {
  target: EditTarget;
  cc: ClientsConfigFull;
  onTeamRename: (oldName: string, newName: string) => void;
  onClientRename: (oldName: string, newName: string) => void;
  onMainRename: (oldName: string, newName: string) => void;
  onSubRename: (oldName: string, newName: string) => void;
  onWorkTypeRename: (oldName: string, newName: string) => void;
  onWorkTypeParentsChange: (name: string, parents: string[]) => void;
  onAddSubUnder: (parentMain: string) => void;
  onAddWorkTypeUnder: (parentName: string) => void;
  onDeleteSub: (name: string) => void;
  onDetachWorkType: (wtName: string, parent: string) => void;
  onDeleteSelf: () => void;
  onClose: () => void;
}

const EditDialog = (props: EditDialogProps) => {
  const { target, cc, onClose } = props;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {target.kind === "team" && (
          <EditSimple
            kind="team"
            name={target.name}
            onRename={props.onTeamRename}
            onDelete={props.onDeleteSelf}
            onClose={onClose}
            note="Renaming cascades to every employee and allocation record that references this team."
          />
        )}
        {target.kind === "client" && (
          <EditClient
            name={target.name}
            cc={cc}
            onRename={props.onClientRename}
            onDelete={props.onDeleteSelf}
            onClose={onClose}
          />
        )}
        {target.kind === "mainCategory" && (
          <EditMainCategory
            name={target.name}
            cc={cc}
            onRename={props.onMainRename}
            onAddSubUnder={props.onAddSubUnder}
            onAddWorkTypeUnder={props.onAddWorkTypeUnder}
            onOpenSub={(subName) => {
              /* This opens the sub edit inline — handled via state in parent.
                 For this turn, clicking a sub row just closes and re-opens
                 via detached action; skipping that refinement to keep scope
                 contained. */
            }}
            onDeleteSub={props.onDeleteSub}
            onDetachWorkType={props.onDetachWorkType}
            onDeleteSelf={props.onDeleteSelf}
            onClose={onClose}
          />
        )}
        {target.kind === "subCategory" && (
          <EditSubCategory
            name={target.name}
            cc={cc}
            onRename={props.onSubRename}
            onAddWorkTypeUnder={props.onAddWorkTypeUnder}
            onDetachWorkType={props.onDetachWorkType}
            onDeleteSelf={props.onDeleteSelf}
            onClose={onClose}
          />
        )}
        {target.kind === "workType" && (
          <EditWorkType
            name={target.name}
            cc={cc}
            onRename={props.onWorkTypeRename}
            onParentsChange={props.onWorkTypeParentsChange}
            onDeleteSelf={props.onDeleteSelf}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Edit dialog for teams/clients — name + cascade warning. */
const EditSimple = ({
  kind, name, onRename, onDelete, onClose, note,
}: {
  kind: "team" | "client";
  name: string;
  onRename: (oldName: string, newName: string) => void;
  onDelete: () => void;
  onClose: () => void;
  note: string;
}) => {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const save = () => {
    const t = value.trim();
    if (!t || t === name) { onClose(); return; }
    onRename(name, t);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">Edit {kind === "team" ? "Team" : "Client"}</DialogTitle>
        <DialogDescription className="text-sm">{note}</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5 pt-2">
        <Label className="text-xs font-medium">Name</Label>
        <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
          onKeyDown={(e) => e.key === "Enter" && save()} />
      </div>
      <DialogFooter className="flex items-center justify-between w-full gap-2">
        <Button variant="ghost" onClick={onDelete} size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={save} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>Save</Button>
        </div>
      </DialogFooter>
    </>
  );
};

/** Edit dialog for a client — name + sub category assignment checkboxes. */
const EditClient = ({
  name, cc, onRename, onDelete, onClose,
}: {
  name: string;
  cc: ClientsConfigFull;
  onRename: (oldName: string, newName: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) => {
  const [value, setValue] = useState(name);
  const [assignedSubs, setAssignedSubs] = useState<Set<string>>(
    () => new Set(cc.subCategories.filter((s) => s.clients?.includes(name)).map((s) => s.name)),
  );

  useEffect(() => {
    setValue(name);
    setAssignedSubs(new Set(cc.subCategories.filter((s) => s.clients?.includes(name)).map((s) => s.name)));
  }, [name, cc.subCategories]);

  const toggleSub = (subName: string) =>
    setAssignedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(subName)) next.delete(subName);
      else next.add(subName);
      return next;
    });

  const save = () => {
    const t = value.trim();
    const effectiveName = t || name;
    const nameChanged = !!t && t !== name;

    // Apply sub category client assignment changes
    for (const sub of cc.subCategories) {
      const currentlyIn = (sub.clients ?? []).includes(name);
      const desiredIn = assignedSubs.has(sub.name);
      let newClients = [...(sub.clients ?? [])];
      if (currentlyIn && !desiredIn) {
        newClients = newClients.filter((c) => c !== name);
      } else if (currentlyIn && desiredIn && nameChanged) {
        newClients = newClients.map((c) => (c === name ? effectiveName : c));
      } else if (!currentlyIn && desiredIn) {
        newClients = [...newClients, effectiveName];
      } else {
        continue;
      }
      cc.setSubCategoryClients(sub.name, newClients);
    }

    if (nameChanged) {
      onRename(name, effectiveName); // cascades rename + closes modal
    } else {
      toast.success("Client assignments updated.");
      onClose();
    }
  };

  // Group sub categories by their parent main category for display
  const groupedSubs = cc.mainCategories
    .map((main) => ({
      main,
      subs: cc.subCategories.filter((s) => s.parentMainCategory === main),
    }))
    .filter((g) => g.subs.length > 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">Edit Client</DialogTitle>
        <DialogDescription className="text-sm">
          Rename or manage which sub categories (projects) this client is assigned to.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Name</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()} />
          <p className="text-[11px]" style={{ color: "hsl(220 10% 50%)" }}>
            Renaming cascades to allocation records and @-tags in journal entries.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium">
            Sub Category Assignments{" "}
            <span className="tabular-nums font-normal" style={{ color: "hsl(220 10% 50%)" }}>
              ({assignedSubs.size} assigned)
            </span>
          </Label>
          {groupedSubs.length === 0 ? (
            <p className="text-[12px] py-2" style={{ color: "hsl(220 10% 55%)" }}>
              No sub categories configured yet.
            </p>
          ) : (
            <div className="rounded-md max-h-[260px] overflow-y-auto"
              style={{ border: "1px solid hsl(220 13% 91%)" }}>
              {groupedSubs.map(({ main, subs }) => (
                <div key={main}>
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold"
                    style={{ background: "hsl(220 14% 97%)", borderBottom: "1px solid hsl(220 13% 93%)", color: "hsl(220 10% 45%)" }}>
                    {main}
                  </div>
                  <div className="divide-y" style={{ borderColor: "hsl(220 13% 94%)" }}>
                    {subs.map((sub) => {
                      const isAssigned = assignedSubs.has(sub.name);
                      return (
                        <button key={sub.name} type="button" onClick={() => toggleSub(sub.name)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors"
                          style={{ color: "hsl(222 20% 15%)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 14% 96%)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                          <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                            style={{
                              background: isAssigned ? "hsl(224 72% 45%)" : "transparent",
                              border: isAssigned ? "1px solid hsl(224 72% 45%)" : "1px solid hsl(220 13% 85%)",
                              color: "hsl(0 0% 100%)",
                            }}>
                            {isAssigned && <Check className="h-3 w-3" strokeWidth={3} />}
                          </div>
                          <Layers className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(224 72% 45%)" }} />
                          <span className="font-medium">{sub.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="flex items-center justify-between w-full gap-2">
        <Button variant="ghost" onClick={onDelete} size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={save} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>Save</Button>
        </div>
      </DialogFooter>
    </>
  );
};

/** Edit dialog for a main category — name + subs section + work types section */
const EditMainCategory = ({
  name, cc, onRename, onAddSubUnder, onAddWorkTypeUnder, onDeleteSub,
  onDetachWorkType, onDeleteSelf, onClose,
}: {
  name: string;
  cc: ClientsConfigFull;
  onRename: (oldName: string, newName: string) => void;
  onAddSubUnder: (parentMain: string) => void;
  onAddWorkTypeUnder: (parentName: string) => void;
  onOpenSub?: (subName: string) => void;
  onDeleteSub: (name: string) => void;
  onDetachWorkType: (wtName: string, parent: string) => void;
  onDeleteSelf: () => void;
  onClose: () => void;
}) => {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  const subs = cc.subCategoriesForMain(name);
  const directWorkTypes = subs.length === 0
    ? cc.workTypes.filter((w) => w.parents.includes(name))
    : [];

  const save = () => {
    const t = value.trim();
    if (!t || t === name) { onClose(); return; }
    onRename(name, t);
    // Parent will re-open the edit dialog for the new name.
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">Edit Main Category</DialogTitle>
        <DialogDescription className="text-sm">
          Renaming cascades to sub categories and work type parents.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Name</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()} />
        </div>

        {/* Sub Categories section */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs font-medium">
              Sub Categories <span className="tabular-nums" style={{ color: "hsl(220 10% 50%)" }}>({subs.length})</span>
            </Label>
            <GhostAddButton onClick={() => onAddSubUnder(name)} label="Create new sub category" small />
          </div>
          {subs.length === 0 ? (
            <p className="text-[12px] py-2" style={{ color: "hsl(220 10% 55%)" }}>
              None yet. Adding a sub category nests work types under it instead of directly under this main.
            </p>
          ) : (
            <ul className="rounded-md divide-y" style={{ border: "1px solid hsl(220 13% 91%)", borderColor: "hsl(220 13% 94%)" }}>
              {subs.map((sub) => {
                const wtCount = cc.workTypes.filter((w) => w.parents.includes(sub.name)).length;
                return (
                  <li key={sub.name} className="group flex items-center gap-2 px-3 py-2">
                    <Layers className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(224 72% 45%)" }} />
                    <span className="text-[13px] font-medium flex-1" style={{ color: "hsl(222 20% 15%)" }}>{sub.name}</span>
                    <span className="text-[11px] tabular-nums" style={{ color: "hsl(220 10% 55%)" }}>
                      {wtCount} work {wtCount === 1 ? "type" : "types"}
                    </span>
                    <IconButton onClick={() => onDeleteSub(sub.name)} label={`Delete ${sub.name}`} variant="danger" size="sm">
                      <Trash2 className="h-3 w-3" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Work Types section — only if no subs */}
        {subs.length === 0 ? (
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium">
                Work Types <span className="tabular-nums" style={{ color: "hsl(220 10% 50%)" }}>({directWorkTypes.length})</span>
              </Label>
              <GhostAddButton onClick={() => onAddWorkTypeUnder(name)} label="Add work type" small />
            </div>
            {directWorkTypes.length === 0 ? (
              <p className="text-[12px] py-2" style={{ color: "hsl(220 10% 55%)" }}>
                None yet. Work types attached here will appear in allocation cards under this category.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {directWorkTypes.map((wt) => (
                  <WorkTypeInlineChip key={wt.name} workType={wt} parentName={name} onDetach={onDetachWorkType} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md px-3 py-2 text-[12px]"
            style={{ background: "hsl(220 14% 96%)", color: "hsl(220 10% 45%)" }}>
            Work types attach to sub categories. Edit each sub category to manage its work types.
          </div>
        )}
      </div>

      <DialogFooter className="flex items-center justify-between w-full gap-2">
        <Button variant="ghost" onClick={onDeleteSelf} size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} size="sm">Close</Button>
          <Button onClick={save} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>Save</Button>
        </div>
      </DialogFooter>
    </>
  );
};

/** Edit dialog for a sub category — name + parent (read-only) + work types + client assignments */
const EditSubCategory = ({
  name, cc, onRename, onAddWorkTypeUnder, onDetachWorkType, onDeleteSelf, onClose,
}: {
  name: string;
  cc: ClientsConfigFull;
  onRename: (oldName: string, newName: string) => void;
  onAddWorkTypeUnder: (parentName: string) => void;
  onDetachWorkType: (wtName: string, parent: string) => void;
  onDeleteSelf: () => void;
  onClose: () => void;
}) => {
  const [value, setValue] = useState(name);
  const sub = cc.subCategories.find((s) => s.name === name);
  const parentMain = sub?.parentMainCategory ?? "";
  const workTypesHere = cc.workTypes.filter((w) => w.parents.includes(name));

  const [assignedClients, setAssignedClients] = useState<string[]>(sub?.clients ?? []);

  useEffect(() => {
    setValue(name);
    const s = cc.subCategories.find((x) => x.name === name);
    setAssignedClients(s?.clients ?? []);
  }, [name, cc.subCategories]);

  const toggleClient = (clientName: string) =>
    setAssignedClients((prev) =>
      prev.includes(clientName) ? prev.filter((c) => c !== clientName) : [...prev, clientName],
    );

  const save = () => {
    const t = value.trim();
    const currentClients = cc.subCategories.find((s) => s.name === name)?.clients ?? [];
    const clientsChanged =
      JSON.stringify([...assignedClients].sort()) !== JSON.stringify([...currentClients].sort());

    if (clientsChanged) {
      cc.setSubCategoryClients(name, assignedClients);
    }

    if (t && t !== name) {
      onRename(name, t); // keeps modal open with new name
    } else {
      if (clientsChanged) toast.success("Client assignments saved.");
      onClose();
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">Edit Sub Category</DialogTitle>
        <DialogDescription className="text-sm">
          Rename, manage work types, or assign clients to this sub category.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Name</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Parent main category</Label>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-[13px]"
            style={{ background: "hsl(220 14% 96%)", color: "hsl(222 20% 25%)" }}>
            <Folder className="h-3.5 w-3.5" style={{ color: "hsl(224 72% 45%)" }} />
            {parentMain}
          </div>
          <p className="text-[11px]" style={{ color: "hsl(220 10% 50%)" }}>
            Parent is fixed at creation time. To move this sub category, delete it and recreate.
          </p>
        </div>

        <div className="pt-1">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs font-medium">
              Work Types <span className="tabular-nums" style={{ color: "hsl(220 10% 50%)" }}>({workTypesHere.length})</span>
            </Label>
            <GhostAddButton onClick={() => onAddWorkTypeUnder(name)} label="Add work type" small />
          </div>
          {workTypesHere.length === 0 ? (
            <p className="text-[12px] py-2" style={{ color: "hsl(220 10% 55%)" }}>
              None yet. Attach existing work types or create new ones.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {workTypesHere.map((wt) => (
                <WorkTypeInlineChip key={wt.name} workType={wt} parentName={name} onDetach={onDetachWorkType} />
              ))}
            </div>
          )}
        </div>

        <div className="pt-1">
          <Label className="text-xs font-medium">
            Assigned Clients{" "}
            <span className="tabular-nums font-normal" style={{ color: "hsl(220 10% 50%)" }}>
              ({assignedClients.length} assigned)
            </span>
          </Label>
          {cc.clients.length === 0 ? (
            <p className="text-[12px] py-2 mt-1" style={{ color: "hsl(220 10% 55%)" }}>
              No clients configured yet.
            </p>
          ) : (
            <div className="mt-2 rounded-md max-h-[200px] overflow-y-auto divide-y"
              style={{ border: "1px solid hsl(220 13% 91%)", borderColor: "hsl(220 13% 94%)" }}>
              {[...cc.clients].sort().map((client) => {
                const isAssigned = assignedClients.includes(client);
                return (
                  <button key={client} type="button" onClick={() => toggleClient(client)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors"
                    style={{ color: "hsl(222 20% 15%)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 14% 96%)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                      style={{
                        background: isAssigned ? "hsl(224 72% 45%)" : "transparent",
                        border: isAssigned ? "1px solid hsl(224 72% 45%)" : "1px solid hsl(220 13% 85%)",
                        color: "hsl(0 0% 100%)",
                      }}>
                      {isAssigned && <Check className="h-3 w-3" strokeWidth={3} />}
                    </div>
                    <Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(220 10% 50%)" }} />
                    <span className="font-medium">{client}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="flex items-center justify-between w-full gap-2">
        <Button variant="ghost" onClick={onDeleteSelf} size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={save} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>Save</Button>
        </div>
      </DialogFooter>
    </>
  );
};

/** Edit dialog for a work type — name + parents multi-select */
const EditWorkType = ({
  name, cc, onRename, onParentsChange, onDeleteSelf, onClose,
}: {
  name: string;
  cc: ClientsConfigFull;
  onRename: (oldName: string, newName: string) => void;
  onParentsChange: (name: string, parents: string[]) => void;
  onDeleteSelf: () => void;
  onClose: () => void;
}) => {
  const wt = cc.workTypes.find((w) => w.name === name);
  const [value, setValue] = useState(name);
  const [parents, setParents] = useState<string[]>(wt?.parents ?? []);
  useEffect(() => {
    setValue(name);
    setParents(wt?.parents ?? []);
  }, [name, wt]);

  const parentGroups = cc.mainCategories.map((main) => {
    const subs = cc.subCategoriesForMain(main);
    return {
      main,
      items: subs.length === 0 ? [main] : subs.map((s) => s.name),
      hasSubs: subs.length > 0,
    };
  });

  const save = () => {
    const t = value.trim();
    if (t && t !== name) onRename(name, t);
    if (JSON.stringify(parents) !== JSON.stringify(wt?.parents ?? [])) {
      onParentsChange(t || name, parents);
    }
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg">Edit Work Type</DialogTitle>
        <DialogDescription className="text-sm">
          Rename or change which parents this work type belongs to.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Name</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Parents</Label>
          <div className="max-h-[260px] overflow-y-auto rounded-md"
            style={{ border: "1px solid hsl(220 13% 91%)" }}>
            <ParentsPicker parentGroups={parentGroups} selected={parents}
              onToggle={(n) => setParents((prev) => prev.includes(n) ? prev.filter((p) => p !== n) : [...prev, n])}
            />
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "hsl(220 10% 50%)" }}>
            {parents.length === 0
              ? "⚠ No parents — this work type will be orphaned."
              : parents.length === 1
                ? "Attached to one parent."
                : `Shared across ${parents.length} parents.`}
          </p>
        </div>
      </div>

      <DialogFooter className="flex items-center justify-between w-full gap-2">
        <Button variant="ghost" onClick={onDeleteSelf} size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={save} size="sm" style={{ background: "hsl(224 72% 45%)", color: "white" }}>Save</Button>
        </div>
      </DialogFooter>
    </>
  );
};

// =====================================================================
// Small shared bits
// =====================================================================

const WorkTypeInlineChip = ({ workType, parentName, onDetach }: {
  workType: WorkType;
  parentName: string;
  onDetach: (wtName: string, parentName: string) => void;
}) => {
  const [hover, setHover] = useState(false);
  const isShared = workType.parents.length > 1;
  return (
    <div className="inline-flex items-stretch h-7 rounded-md overflow-hidden"
      style={{ background: "hsl(220 14% 95%)", border: "1px solid hsl(220 13% 90%)" }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="flex items-center gap-1.5 px-2.5 text-[12.5px] font-medium"
        style={{ color: "hsl(222 20% 20%)" }}>
        {isShared && <Link2 className="h-3 w-3 shrink-0" style={{ color: "hsl(224 72% 50%)" }} />}
        {workType.name}
      </span>
      {hover && (
        <button onClick={() => onDetach(workType.name, parentName)}
          aria-label={`Detach ${workType.name} from ${parentName}`}
          className="flex items-center justify-center w-6 px-1 transition-colors"
          style={{ borderLeft: "1px solid hsl(220 13% 90%)", color: "hsl(0 62% 55%)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(0 84% 95%)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

// Outline chip (reused in outline view)
const WorkTypeChipRow = ({ workTypes, parentName, onClick, onDetach }: {
  workTypes: readonly WorkType[]; parentName: string;
  onClick: (wt: WorkType) => void;
  onDetach: (workTypeName: string, parentName: string) => void;
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {workTypes.map((wt) => (
      <WorkTypeChip key={wt.name} workType={wt} parentName={parentName}
        onClick={() => onClick(wt)}
        onDetach={() => onDetach(wt.name, parentName)}
      />
    ))}
  </div>
);

const WorkTypeChip = ({ workType, parentName, onClick, onDetach }: {
  workType: WorkType; parentName: string;
  onClick: () => void; onDetach: () => void;
}) => {
  const [hover, setHover] = useState(false);
  const isShared = workType.parents.length > 1;
  const otherParents = workType.parents.filter((p) => p !== parentName);
  return (
    <div className="inline-flex items-stretch h-7 rounded-md overflow-hidden transition-colors"
      style={{ background: "hsl(220 14% 95%)", border: "1px solid hsl(220 13% 90%)" }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button onClick={onClick}
        className="flex items-center gap-1.5 px-2.5 text-[12.5px] font-medium transition-colors"
        style={{ color: "hsl(222 20% 20%)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 14% 92%)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        title={isShared ? `${workType.name} · shared with ${otherParents.join(", ")}` : workType.name}>
        {isShared && <Link2 className="h-3 w-3 shrink-0" style={{ color: "hsl(224 72% 50%)" }} />}
        <span>{workType.name}</span>
      </button>
      {hover && (
        <button onClick={onDetach} aria-label={`Detach ${workType.name} from ${parentName}`}
          title={`Detach from ${parentName}`}
          className="flex items-center justify-center w-6 px-1 transition-colors"
          style={{ borderLeft: "1px solid hsl(220 13% 90%)", color: "hsl(0 62% 55%)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(0 84% 95%)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

const ParentChips = ({ parents }: { parents: readonly string[] }) => {
  if (parents.length === 0) return <span className="text-[12px]" style={{ color: "hsl(38 80% 45%)" }}>No parents</span>;
  const visible = parents.slice(0, 3);
  const overflow = parents.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((p) => (
        <span key={p} className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium"
          style={{ background: "hsl(224 72% 95%)", color: "hsl(224 72% 35%)" }}>{p}</span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-medium"
          style={{ background: "hsl(220 14% 93%)", color: "hsl(220 10% 40%)" }}>+{overflow}</span>
      )}
    </div>
  );
};

const IconButton = ({ onClick, label, variant, size = "md", children }: {
  onClick: () => void; label: string;
  variant: "neutral" | "danger" | "accent"; size?: "sm" | "md";
  children: React.ReactNode;
}) => {
  const colors = {
    neutral: { text: "hsl(220 10% 45%)", hoverBg: "hsl(220 14% 93%)", hoverText: "hsl(222 20% 15%)" },
    danger:  { text: "hsl(0 62% 55%)",   hoverBg: "hsl(0 84% 95%)",   hoverText: "hsl(0 72% 45%)" },
    accent:  { text: "hsl(224 50% 50%)", hoverBg: "hsl(224 72% 95%)", hoverText: "hsl(224 72% 40%)" },
  }[variant];
  const sizeClass = size === "sm" ? "w-6 h-6" : "w-7 h-7";
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={`flex items-center justify-center rounded-md transition-colors ${sizeClass}`}
      style={{ color: colors.text }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.hoverBg; e.currentTarget.style.color = colors.hoverText; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = colors.text; }}>
      {children}
    </button>
  );
};

const GhostAddButton = ({ onClick, label, small = false, muted = false }: {
  onClick: () => void; label: string; small?: boolean; muted?: boolean;
}) => {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className={`inline-flex items-center gap-1.5 rounded-md transition-all ${small ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]"}`}
      style={{
        border: `1px dashed ${hover ? "hsl(224 72% 55%)" : muted ? "hsl(220 13% 85%)" : "hsl(220 13% 80%)"}`,
        background: hover ? "hsl(224 72% 97%)" : "transparent",
        color: hover ? "hsl(224 72% 40%)" : muted ? "hsl(220 10% 55%)" : "hsl(220 10% 45%)",
      }}>
      <Plus className={small ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {label}
    </button>
  );
};

// Sort / pagination helpers
function paginate<T>(items: readonly T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

function toggleSort<T extends { col: string; dir: SortDirection }>(
  current: T, clicked: T["col"], setSort: (s: T) => void,
): void {
  if (current.col === clicked) setSort({ ...current, dir: current.dir === "asc" ? "desc" : "asc" } as T);
  else setSort({ col: clicked, dir: "asc" } as T);
}

const SortHeader = ({ label, active, dir, onClick, align = "left" }: {
  label: string; active: boolean; dir: SortDirection;
  onClick: () => void; align?: "left" | "right";
}) => (
  <button onClick={onClick}
    className={`flex items-center gap-1 transition-colors ${align === "right" ? "justify-end" : ""}`}
    style={{ color: active ? "hsl(222 20% 25%)" : "hsl(220 10% 45%)" }}>
    <span>{label}</span>
    {active ? (
      dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3 opacity-0 group-hover:opacity-40" style={{ color: "hsl(220 10% 60%)" }} />
    )}
  </button>
);

const PaginationFooter = ({ page, onPageChange, totalItems }: {
  page: number; onPageChange: (p: number) => void; totalItems: number;
}) => {
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  if (totalPages <= 1) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, totalItems);
  const pages: (number | "…")[] = [];
  if (totalPages <= 5) for (let i = 1; i <= totalPages; i++) pages.push(i);
  else if (page <= 3) pages.push(1, 2, 3, 4, "…", totalPages);
  else if (page >= totalPages - 2) pages.push(1, "…", totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
  else pages.push(1, "…", page - 1, page, page + 1, "…", totalPages);
  return (
    <div className="flex items-center justify-between px-5 py-3 text-[12px]"
      style={{ borderTop: "1px solid hsl(220 13% 93%)", color: "hsl(220 10% 45%)" }}>
      <span className="tabular-nums">
        Showing <span style={{ color: "hsl(222 20% 25%)", fontWeight: 500 }}>{from}–{to}</span>{" "}
        of <span style={{ color: "hsl(222 20% 25%)", fontWeight: 500 }}>{totalItems}</span>
      </span>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onPageChange(page - 1)} disabled={page === 1}
          className="flex items-center gap-1 h-7 px-2 rounded text-[12px] transition-colors disabled:opacity-40"
          style={{ color: "hsl(220 10% 40%)" }}
          onMouseEnter={(e) => { if (page > 1) e.currentTarget.style.background = "hsl(220 14% 94%)"; }}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          <ChevronLeft className="h-3 w-3" />Prev
        </button>
        {pages.map((p, i) => p === "…" ? (
          <span key={`e-${i}`} className="px-2 tabular-nums" style={{ color: "hsl(220 8% 60%)" }}>…</span>
        ) : (
          <button key={p} onClick={() => onPageChange(p)}
            className="flex items-center justify-center h-7 min-w-[28px] px-1.5 rounded text-[12px] tabular-nums font-medium transition-colors"
            style={{
              background: p === page ? "hsl(0 0% 100%)" : "transparent",
              color: p === page ? "hsl(222 20% 15%)" : "hsl(220 10% 45%)",
              boxShadow: p === page ? "0 1px 2px 0 hsl(220 13% 85% / 0.5), 0 0 0 1px hsl(220 13% 88%)" : "none",
            }}
            onMouseEnter={(e) => { if (p !== page) e.currentTarget.style.background = "hsl(220 14% 94%)"; }}
            onMouseLeave={(e) => { if (p !== page) e.currentTarget.style.background = "transparent"; }}>
            {p}
          </button>
        ))}
        <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages}
          className="flex items-center gap-1 h-7 px-2 rounded text-[12px] transition-colors disabled:opacity-40"
          style={{ color: "hsl(220 10% 40%)" }}
          onMouseEnter={(e) => { if (page < totalPages) e.currentTarget.style.background = "hsl(220 14% 94%)"; }}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
          Next<ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};

const EmptyTableState = ({ message }: { message: string }) => (
  <div className="flex items-center justify-center py-16 text-sm" style={{ color: "hsl(220 10% 50%)" }}>
    {message}
  </div>
);

interface ParentsMultiSelectProps {
  parentGroups: { main: string; items: string[]; hasSubs: boolean }[];
  selected: string[];
  onChange: (next: string[]) => void;
}

const ParentsMultiSelect = ({ parentGroups, selected, onChange }: ParentsMultiSelectProps) => {
  const [open, setOpen] = useState(false);
  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter((s) => s !== name));
    else onChange([...selected, name]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" type="button" className="w-full justify-between font-normal h-9 text-[13px]">
          {selected.length === 0 ? "None" : `${selected.length} selected`}
          <ChevronDown className="h-3.5 w-3.5" style={{ color: "hsl(220 10% 50%)" }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[320px] overflow-y-auto p-2" align="start">
        <ParentsPicker parentGroups={parentGroups} selected={selected} onToggle={toggle} />
      </PopoverContent>
    </Popover>
  );
};

const ParentsPicker = ({ parentGroups, selected, onToggle }: {
  parentGroups: { main: string; items: string[]; hasSubs: boolean }[];
  selected: string[]; onToggle: (name: string) => void;
}) => (
  <div className="space-y-2 p-1">
    {parentGroups.map((group) => {
      if (group.items.length === 0) return null;
      return (
        <div key={group.main}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-1 px-1"
            style={{ color: "hsl(220 10% 50%)" }}>
            {group.main}
            {group.hasSubs && <span className="ml-1 normal-case font-normal text-[10px]" style={{ color: "hsl(220 8% 60%)" }}>pick sub cats</span>}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const isSelected = selected.includes(item);
              return (
                <button key={item} type="button" onClick={() => onToggle(item)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[13px] transition-colors"
                  style={{ color: "hsl(222 20% 15%)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 14% 95%)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors"
                    style={{
                      background: isSelected ? "hsl(224 72% 45%)" : "transparent",
                      border: isSelected ? "1px solid hsl(224 72% 45%)" : "1px solid hsl(220 13% 85%)",
                      color: "hsl(0 0% 100%)",
                    }}>
                    {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </div>
                  <span>{item}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    })}
  </div>
);

// =====================================================================
// AI Settings panel
// =====================================================================

/**
 * UI for configuring the Claude-backed parser.
 *
 * Fields:
 *   - API key (password-style input, with reveal toggle)
 *   - Model select (Haiku / Sonnet / Opus)
 *   - Enabled toggle
 *   - "Test Key" button — validates the key with a minimal API call
 *
 * Security warning is rendered prominently — localStorage exposure
 * is real and users should know it before pasting a key.
 */
const AISettingsPanel = () => {
  const { config, updateConfig, isAIAvailable } = useAIConfig();
  const [draftKey, setDraftKey] = useState(config.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { status: "ok"; at: number }
    | { status: "error"; message: string; at: number }
    | null
  >(null);

  // Sync draft when config changes from elsewhere (unlikely but safe).
  useEffect(() => {
    setDraftKey(config.apiKey);
  }, [config.apiKey]);

  const hasUnsavedChanges = draftKey !== config.apiKey;

  const handleSaveKey = () => {
    updateConfig({ apiKey: draftKey.trim() });
    setTestResult(null);
    toast.success(
      draftKey.trim().length > 0
        ? "API key saved."
        : "API key cleared. Auto-Generate will use the rule parser.",
    );
  };

  const handleTest = async () => {
    const key = draftKey.trim();
    if (!key) {
      toast.error("Enter an API key first.");
      return;
    }
    setTesting(true);
    setTestResult(null);
    const result = await testApiKey(key, config.model);
    setTesting(false);
    if (result.ok) {
      setTestResult({ status: "ok", at: Date.now() });
    } else {
      const msg =
        result.status === 401
          ? "Invalid API key — check for typos or regenerate."
          : result.status === 429
            ? "Rate limited. Wait a minute and try again."
            : result.status
              ? `API returned ${result.status}: ${result.message}`
              : `Network error: ${result.message}`;
      setTestResult({ status: "error", message: msg, at: Date.now() });
    }
  };

  const modelOptions = [
    { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — fast, cheap (recommended)" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6 — more accurate, slower" },
    { value: "claude-opus-4-7", label: "Opus 4.7 — most accurate, expensive" },
  ];

  return (
    <div className="space-y-6">
      {/* Main configuration card */}
      <div
        className="rounded-xl"
        style={{
          background: "hsl(0 0% 100%)",
          border: "1px solid hsl(220 13% 91%)",
          boxShadow: "0 1px 2px 0 hsl(220 13% 90% / 0.3)",
        }}
      >
        <div
          className="px-6 py-4"
          style={{ borderBottom: "1px solid hsl(220 13% 93%)" }}
        >
          <div className="flex items-center gap-2.5 mb-1">
            <Sparkles
              className="h-4 w-4"
              style={{ color: "hsl(224 72% 45%)" }}
            />
            <h2
              className="text-[15px] font-semibold"
              style={{ color: "hsl(222 20% 15%)" }}
            >
              Claude AI Parser
            </h2>
            {isAIAvailable ? (
              <span
                className="inline-flex items-center h-5 px-2 rounded text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: "hsl(142 76% 93%)",
                  color: "hsl(142 72% 29%)",
                }}
              >
                Active
              </span>
            ) : (
              <span
                className="inline-flex items-center h-5 px-2 rounded text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: "hsl(220 14% 93%)",
                  color: "hsl(220 10% 45%)",
                }}
              >
                Inactive
              </span>
            )}
          </div>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "hsl(220 10% 45%)" }}
          >
            When configured, Auto-Generate uses Claude to classify journal entries into allocation cards.{" "}
            <span style={{ color: "hsl(220 8% 55%)" }}>
              The rule-based parser remains as a fallback when AI is
              unavailable or disabled.
            </span>
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <Label className="text-sm font-medium block mb-0.5">
                Enable AI parsing
              </Label>
              <p
                className="text-[12px]"
                style={{ color: "hsl(220 10% 55%)" }}
              >
                Master switch. When off, Auto-Generate uses rules only.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.enabled}
              onClick={() => updateConfig({ enabled: !config.enabled })}
              className="relative inline-flex h-6 w-11 rounded-full transition-colors"
              style={{
                background: config.enabled
                  ? "hsl(224 72% 45%)"
                  : "hsl(220 13% 85%)",
              }}
            >
              <span
                className="inline-block h-5 w-5 rounded-full bg-white transition-transform"
                style={{
                  transform: config.enabled
                    ? "translateX(22px)"
                    : "translateX(2px)",
                  marginTop: "2px",
                  boxShadow: "0 1px 2px 0 hsl(220 13% 70% / 0.5)",
                }}
              />
            </button>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Anthropic API Key</Label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="pr-10 font-mono text-[13px]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  aria-label={showKey ? "Hide key" : "Show key"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded transition-colors"
                  style={{ color: "hsl(220 10% 45%)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "hsl(220 14% 93%)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  {showKey ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              {hasUnsavedChanges && (
                <Button
                  onClick={handleSaveKey}
                  size="sm"
                  className="h-9 shadow-sm"
                  style={{ background: "hsl(224 72% 45%)", color: "white" }}
                >
                  Save
                </Button>
              )}
              <Button
                onClick={handleTest}
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                disabled={testing || draftKey.trim().length === 0}
              >
                {testing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Testing
                  </>
                ) : (
                  "Test Key"
                )}
              </Button>
            </div>

            {/* Test result */}
            {testResult?.status === "ok" && (
              <div
                className="flex items-center gap-2 text-[12px] pt-1"
                style={{ color: "hsl(142 72% 29%)" }}
              >
                <Check className="h-3.5 w-3.5" />
                Key verified — Claude is reachable.
              </div>
            )}
            {testResult?.status === "error" && (
              <div
                className="flex items-start gap-2 text-[12px] pt-1"
                style={{ color: "hsl(0 72% 45%)" }}
              >
                <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{testResult.message}</span>
              </div>
            )}

            <p className="text-[11px]" style={{ color: "hsl(220 10% 55%)" }}>
              Get a key from{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "hsl(224 72% 45%)", textDecoration: "underline" }}
              >
                console.anthropic.com
              </a>
              . Stored in this browser only; not sent to our servers.
            </p>
          </div>

          {/* Model selector */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Model</Label>
            <Select
              value={config.model}
              onValueChange={(v) => updateConfig({ model: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px]" style={{ color: "hsl(220 10% 55%)" }}>
              Haiku handles classification well at a fraction of the cost. Upgrade if you see consistent misclassifications.
            </p>
          </div>
        </div>
      </div>

      {/* Security note */}
      <div
        className="rounded-xl p-4"
        style={{
          background: "hsl(38 92% 97%)",
          border: "1px solid hsl(38 92% 88%)",
        }}
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="h-4 w-4 mt-0.5 shrink-0"
            style={{ color: "hsl(24 70% 40%)" }}
          />
          <div className="flex-1 min-w-0">
            <p
              className="text-[13px] font-semibold mb-1"
              style={{ color: "hsl(24 70% 30%)" }}
            >
              Security note
            </p>
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: "hsl(24 70% 35%)" }}
            >
              The API key is stored in your browser's localStorage and sent directly to Anthropic from this page. That means any script running on this domain can read it. This is acceptable for internal / single-user use. For multi-tenant production, the key should live on a backend proxy instead.
            </p>
            <p
              className="text-[12px] leading-relaxed mt-2"
              style={{ color: "hsl(24 70% 35%)" }}
            >
              Journal entries and descriptions are sent to Anthropic for classification. Review your organization's data-sharing policies before enabling.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;
