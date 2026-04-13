import { useState, useCallback } from "react";
import { WarehouseConfig, StatCard, type WarehouseParams } from "@/components/warehouse/WarehouseConfig";
import { useStoreParams } from "@/hooks/useStoreParams";
import { useAGVs } from "@/hooks/useAGVs";
import { useOrders } from "@/hooks/useOrders";
import { Warehouse2D } from "@/components/warehouse/Warehouse2D";
import { MovementCommand, type MovementOrder } from "@/components/warehouse/MovementCommand";
import { CombinedMovementCommand, type CombinedExecutionPayload } from "@/components/warehouse/CombinedMovementCommand";
import type { AMROrder } from "@/components/warehouse/AMRCommand";
import { ComponentEditor } from "@/components/warehouse/ComponentEditor";
import {
  defaultComponentStyles,
  type ComponentStyles,
  type ComponentType,
} from "@/components/warehouse/ComponentStyles";
import { useProjects } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Save,
  Undo2,
  Move,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Warehouse,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { toast } from "sonner";

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border">
      <CollapsibleTrigger className="flex items-center justify-between w-full px-6 py-3 hover:bg-muted/50 transition-colors">
        <h2 className="text-sm font-semibold text-accent uppercase tracking-wider">{title}</h2>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-6 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export default function Index() {
  const {
    projects,
    activeProject,
    activeId,
    loading: projectsLoading,
    switchProject,
    addProject,
    updateProject,
    deleteProject,
    renameProject,
  } = useProjects();

  const [movementOrders, setMovementOrders] = useState<MovementOrder[]>([]);
  const [movementOrdersKey, setMovementOrdersKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ComponentType | null>(null);
  const [moveRobotMode, setMoveRobotMode] = useState(false);
  const [amrOrder, setAmrOrder] = useState<AMROrder | null>(null);
  const [amrOrders, setAmrOrders] = useState<AMROrder[]>([]);
  const [amrOrdersKey, setAmrOrdersKey] = useState(0);
  const [isAMRAnimating, setIsAMRAnimating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // New project dialog
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  // Rename dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameTargetId, setRenameTargetId] = useState("");

  // Derived from active project — safe defaults when loading
  const { params: storeParams, loading: storeLoading, error: storeError } = useStoreParams();
  const { agvs } = useAGVs();
  const { orders: agvOrders, loading: ordersLoading, refetch: refetchOrders } = useAGVOrders();
  const { orders: shuttleOrders, loading: shuttleOrdersLoading, refetch: refetchShuttleOrders } = useShuttleOrders();

  // Merge store params with packing station settings from project
  const params: WarehouseParams = {
    ...storeParams,
    packingStations: activeProject?.params?.packingStations ?? storeParams.packingStations,
    slotsPerStation: activeProject?.params?.slotsPerStation ?? storeParams.slotsPerStation,
  };

  const componentStyles = activeProject?.componentStyles ?? defaultComponentStyles;
  const [savedStyles, setSavedStyles] = useState<ComponentStyles>(defaultComponentStyles);

  const setComponentStyles = useCallback(
    (styles: ComponentStyles) => {
      updateProject(activeId, { componentStyles: styles });
    },
    [activeId, updateProject],
  );

  const hasUnsavedChanges = JSON.stringify(componentStyles) !== JSON.stringify(savedStyles);

  const handleSave = useCallback(() => {
    setSavedStyles(componentStyles);
    toast.success("Component styles saved");
  }, [componentStyles]);

  const handleUndo = useCallback(() => {
    setComponentStyles(savedStyles);
    toast.info("Changes reverted to last saved state");
  }, [savedStyles, setComponentStyles]);

  const numAisles = Math.max(1, Math.floor(params.rows / 2));
  const totalSlots = params.rows * params.racks * params.slotsPerRack * params.deep;

  const handleExecuteMovement = useCallback((order: MovementOrder) => {
    setMovementOrders([order]);
    setMovementOrdersKey((k) => k + 1);
    setIsAnimating(true);
  }, []);

  const handleExecuteMovementBatch = useCallback((orders: MovementOrder[]) => {
    if (orders.length === 0) return;
    setMovementOrders(orders);
    setMovementOrdersKey((k) => k + 1);
    setIsAnimating(true);
  }, []);

  const handleAnimationComplete = useCallback(() => {
    setIsAnimating(false);
  }, []);

  const handleReset = useCallback(() => {
    setMovementOrders([]);
    setIsAnimating(false);
  }, []);

  const handleExecuteAMR = useCallback((order: AMROrder) => {
    const nextOrder = { ...order };
    setAmrOrder(nextOrder);
    setAmrOrders([nextOrder]);
    setAmrOrdersKey((k) => k + 1);
    setIsAMRAnimating(true);
  }, []);

  const handleExecuteAMRBatch = useCallback((orders: AMROrder[]) => {
    if (orders.length === 0) return;
    setAmrOrder({ ...orders[0] });
    setAmrOrders(orders.map((order) => ({ ...order })));
    setAmrOrdersKey((k) => k + 1);
    setIsAMRAnimating(true);
  }, []);

  const handleAMRComplete = useCallback(() => {
    setIsAMRAnimating(false);
  }, []);

  const handleAMRReset = useCallback(() => {
    setAmrOrder(null);
    setAmrOrders([]);
    setIsAMRAnimating(false);
  }, []);

  const handleStationCountChange = useCallback(
    (count: number) => {
      updateProject(activeId, { params: { ...params, packingStations: count } });
    },
    [params, activeId, updateProject],
  );

  const handleComponentClick = useCallback((type: ComponentType) => {
    setEditingComponent(type);
    setEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingComponent(null);
  }, []);

  const handleCreateProject = useCallback(() => {
    const name = newProjectName.trim() || `Project ${projects.length + 1}`;
    addProject(name);
    setNewProjectOpen(false);
    setNewProjectName("");
    setMovementOrders([]);
    setIsAnimating(false);
    toast.success(`Created "${name}"`);
  }, [newProjectName, projects.length, addProject]);

  const handleSwitchProject = useCallback(
    (id: string) => {
      switchProject(id);
      setMovementOrders([]);
      setIsAnimating(false);
      const proj = projects.find((p) => p.id === id);
      if (proj) setSavedStyles(proj.componentStyles);
    },
    [switchProject, projects],
  );

  const handleDeleteProject = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (projects.length <= 1) {
        toast.error("Cannot delete the only project");
        return;
      }
      const proj = projects.find((p) => p.id === id);
      deleteProject(id);
      toast.success(`Deleted "${proj?.name}"`);
    },
    [projects, deleteProject],
  );

  const handleOpenRename = useCallback((id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameTargetId(id);
    setRenameValue(currentName);
    setRenameOpen(true);
  }, []);

  const handleRename = useCallback(() => {
    if (renameValue.trim()) {
      renameProject(renameTargetId, renameValue.trim());
      toast.success("Project renamed");
    }
    setRenameOpen(false);
  }, [renameTargetId, renameValue, renameProject]);

  if (projectsLoading || !activeProject) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div
        className={`bg-sidebar border-r border-border flex flex-col h-full overflow-y-auto transition-all duration-300 ${
          sidebarOpen ? "w-80 min-w-[320px]" : "w-0 min-w-0 overflow-hidden"
        }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Warehouse className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-foreground">Warehouse Viewer</h1>
              <p className="text-xs text-muted-foreground">Nano Warehouse Robot Map</p>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(false)} className="shrink-0">
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Collapsible: Warehouse Parameters */}
        <CollapsibleSection title="Warehouse Parameters" defaultOpen>
          <WarehouseConfig params={params} loading={storeLoading} error={storeError} headless />
        </CollapsibleSection>

        {/* Collapsible: Shuttle Movement */}
        <CollapsibleSection title="Shuttle Movement">
          <MovementCommand
            params={params}
            onExecute={handleExecuteMovement}
            onExecuteBatch={handleExecuteMovementBatch}
            isAnimating={isAnimating}
            onReset={handleReset}
            shuttleOrders={shuttleOrders}
            shuttleOrdersLoading={shuttleOrdersLoading}
            onRefetchShuttleOrders={refetchShuttleOrders}
          />
        </CollapsibleSection>

        {/* Collapsible: AMR Movement */}
        <CollapsibleSection title="AMR Movement">
          <AMRCommand
            params={params}
            onExecute={handleExecuteAMR}
            onExecuteBatch={handleExecuteAMRBatch}
            isAnimating={isAMRAnimating}
            onReset={handleAMRReset}
            onStationCountChange={handleStationCountChange}
            orders={agvOrders}
            ordersLoading={ordersLoading}
            onRefetchOrders={refetchOrders}
          />
        </CollapsibleSection>

        <div className="px-6 pb-6">
          <div className="border-t border-border pt-4 space-y-3">
            <h2 className="text-sm font-semibold text-accent uppercase tracking-wider">Summary</h2>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Slots" value={totalSlots.toLocaleString()} />
              <StatCard label="Aisles" value={numAisles.toLocaleString()} />
              <StatCard label="Total Racks" value={(params.rows * params.racks * params.deep).toLocaleString()} />
              <StatCard label="Levels" value={params.slotsPerRack.toLocaleString()} />
              <StatCard label="Area" value={`${(params.length * params.width).toFixed(1)} m²`} />
              <StatCard label="Volume" value={`${(params.length * params.width * params.height).toFixed(1)} m³`} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-14 bg-card border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {/* Sidebar toggle when collapsed */}
            {!sidebarOpen && (
              <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(true)}>
                <PanelLeft className="w-4 h-4" />
              </Button>
            )}

            {/* Project Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 max-w-[200px]">
                  <span className="truncate">{activeProject.name}</span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => handleSwitchProject(p.id)}
                    className={`flex items-center justify-between ${p.id === activeId ? "bg-accent/20" : ""}`}
                  >
                    <span className="truncate flex-1">{p.name}</span>
                    <span className="flex items-center gap-1 shrink-0 ml-2">
                      <button
                        onClick={(e) => handleOpenRename(p.id, p.name, e)}
                        className="p-1 hover:bg-accent rounded"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      {projects.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteProject(p.id, e)}
                          className="p-1 hover:bg-destructive/20 rounded text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-xs text-muted-foreground hidden lg:inline">
              {numAisles} aisles · {params.deep}x deep · {params.slotsPerRack} levels · {totalSlots.toLocaleString()}{" "}
              slots
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={moveRobotMode ? "default" : "outline"}
              onClick={() => setMoveRobotMode(!moveRobotMode)}
              className="gap-1.5"
              disabled={isAnimating}
            >
              <Move className="w-4 h-4" />
              {moveRobotMode ? "Moving..." : "Move "}
            </Button>
            <Button size="sm" variant="outline" onClick={handleUndo} className="gap-1.5" disabled={!hasUnsavedChanges}>
              <Undo2 className="w-4 h-4" />
              Undo
            </Button>
            <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={!hasUnsavedChanges}>
              <Save className="w-4 h-4" />
              Save
            </Button>
          </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 relative">
          <Warehouse2D
            params={params}
            movementOrders={movementOrders}
            movementOrdersKey={movementOrdersKey}
            onAnimationComplete={handleAnimationComplete}
            componentStyles={componentStyles}
            onComponentClick={handleComponentClick}
            moveRobotMode={moveRobotMode}
            amrOrders={amrOrders}
            amrOrdersKey={amrOrdersKey}
            onAMRComplete={handleAMRComplete}
            agvs={agvs}
          />
        </div>
      </div>

      <ComponentEditor
        open={editorOpen}
        onClose={handleEditorClose}
        componentType={editingComponent}
        styles={componentStyles}
        onStyleChange={setComponentStyles}
      />

      {/* New Project Dialog */}
      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder={`Project ${projects.length + 1}`}
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewProjectOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProject}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
