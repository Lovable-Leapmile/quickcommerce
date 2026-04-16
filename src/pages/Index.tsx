import { useState, useCallback, useRef } from "react";
import { WarehouseConfig, StatCard, type WarehouseParams } from "@/components/warehouse/WarehouseConfig";
import { useStoreParams } from "@/hooks/useStoreParams";
import { useStores } from "@/hooks/useStores";
import { useAGVs } from "@/hooks/useAGVs";
import { useOrders } from "@/hooks/useOrders";
import { Warehouse2D } from "@/components/warehouse/Warehouse2D";
import { type MovementOrder } from "@/components/warehouse/MovementCommand";
import { CombinedMovementCommand, type CombinedExecutionPayload } from "@/components/warehouse/CombinedMovementCommand";
import { OrderOverlay } from "@/components/warehouse/OrderOverlay";
import type { AMROrder } from "@/components/warehouse/AMRCommand";
import { ComponentEditor } from "@/components/warehouse/ComponentEditor";
import {
  defaultComponentStyles,
  type ComponentStyles,
  type ComponentType,
} from "@/components/warehouse/ComponentStyles";
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
  // Fetch all stores from API as projects
  const { stores, loading: storesLoading } = useStores();
  const [activeStoreId, setActiveStoreId] = useState<number>(1);

  const projects = stores.map((s) => ({
    id: String(s.store_id),
    name: s.store_name,
    storeId: s.store_id,
  }));
  const activeProject = projects.find((p) => p.storeId === activeStoreId) || projects[0];
  const activeId = activeProject?.id ?? "";
  const projectsLoading = storesLoading;

  const switchProject = useCallback((id: string) => {
    const store = stores.find((s) => String(s.store_id) === id);
    if (store) setActiveStoreId(store.store_id);
  }, [stores]);

  const [movementOrders, setMovementOrders] = useState<MovementOrder[]>([]);
  const [movementOrdersKey, setMovementOrdersKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<ComponentType | null>(null);
  const [moveRobotMode, setMoveRobotMode] = useState(false);
  const [_amrOrder, _setAmrOrder] = useState<AMROrder | null>(null);
  const [amrOrders, setAmrOrders] = useState<AMROrder[]>([]);
  const [amrOrdersKey, setAmrOrdersKey] = useState(0);
  const [isAMRAnimating, setIsAMRAnimating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [amrSpeed, setAmrSpeed] = useState(0.5);
  const orderStartTimeRef = useRef<number | null>(null);
  const [orderCompletedTimes, setOrderCompletedTimes] = useState<Record<number, number>>({});
  const activeOrderIdRef = useRef<number | null>(null);

  // Derived from active project — safe defaults when loading
  const { params: storeParams, loading: storeLoading, error: storeError } = useStoreParams(activeStoreId);
  const { agvs } = useAGVs();
  const { orders: combinedOrders, loading: combinedOrdersLoading, refetch: refetchCombinedOrders } = useOrders();
  const [activeAgvCounts, setActiveAgvCounts] = useState<Record<number, number>>({});

  // Merge store params with packing station settings
  const params: WarehouseParams = {
    ...storeParams,
  };

  const initialTrayLabels = combinedOrders.flatMap((order) =>
    order.items.map((item, idx) => ({
      row: item.srcRow,
      rack: item.srcRack,
      deep: item.srcDeep,
      itemIndex: idx + 1,
    })),
  );

  const [componentStyles, setComponentStyles] = useState<ComponentStyles>(defaultComponentStyles);
  const [savedStyles, setSavedStyles] = useState<ComponentStyles>(defaultComponentStyles);

  const hasUnsavedChanges = JSON.stringify(componentStyles) !== JSON.stringify(savedStyles);

  const handleSave = useCallback(() => {
    setSavedStyles(componentStyles);
    toast.success("Component styles saved");
  }, [componentStyles]);

  const handleUndo = useCallback(() => {
    setComponentStyles(savedStyles);
    toast.info("Changes reverted to last saved state");
  }, [savedStyles]);

  const numAisles = Math.max(1, Math.floor(params.rows / 2));
  const totalSlots = params.rows * params.racks * params.slotsPerRack * params.deep;

  const handleCombinedExecute = useCallback((payload: CombinedExecutionPayload) => {
    if (payload.orderId != null) {
      activeOrderIdRef.current = payload.orderId;
      orderStartTimeRef.current = Date.now();
    }
    if (payload.shuttleOrders.length > 0) {
      setMovementOrders(payload.shuttleOrders);
      setMovementOrdersKey((k) => k + 1);
      setIsAnimating(true);
    }
    if (payload.amrOrders.length > 0) {
      setAmrOrders(payload.amrOrders.map((o) => ({ ...o })));
      setAmrOrdersKey((k) => k + 1);
      setIsAMRAnimating(true);
    }
  }, []);

  const handleDeliveryComplete = useCallback(() => {
    if (activeOrderIdRef.current != null && orderStartTimeRef.current != null) {
      const elapsed = (Date.now() - orderStartTimeRef.current) / 1000;
      const orderId = activeOrderIdRef.current;
      setOrderCompletedTimes((prev) => ({ ...prev, [orderId]: elapsed }));
      activeOrderIdRef.current = null;
      orderStartTimeRef.current = null;
    }
  }, []);

  const handleCombinedReset = useCallback(() => {
    setMovementOrders([]);
    setIsAnimating(false);
    setAmrOrders([]);
    setIsAMRAnimating(false);
  }, []);

  const handleStationCountChange = useCallback(
    (_count: number) => {
      // Station count comes from store config, read-only
    },
    [],
  );

  const handleComponentClick = useCallback((type: ComponentType) => {
    setEditingComponent(type);
    setEditorOpen(true);
  }, []);

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingComponent(null);
  }, []);

  const handleSwitchProject = useCallback(
    (id: string) => {
      switchProject(id);
      setMovementOrders([]);
      setIsAnimating(false);
    },
    [switchProject],
  );

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

        {/* Collapsible: Movement */}
        <CollapsibleSection title="Movement" defaultOpen>
          <CombinedMovementCommand
            params={params}
            orders={combinedOrders}
            ordersLoading={combinedOrdersLoading}
            onRefetchOrders={refetchCombinedOrders}
            onExecute={handleCombinedExecute}
            onReset={handleCombinedReset}
            onStationCountChange={handleStationCountChange}
            onAgvSelectionChange={(orderId, count) => setActiveAgvCounts((prev) => ({ ...prev, [orderId]: count }))}
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
                  </DropdownMenuItem>
                ))}
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
            initialTrayLabels={initialTrayLabels}
            onAnimationComplete={() => setIsAnimating(false)}
            componentStyles={componentStyles}
            onComponentClick={handleComponentClick}
            moveRobotMode={moveRobotMode}
            amrOrders={amrOrders}
            amrOrdersKey={amrOrdersKey}
            onAMRComplete={() => setIsAMRAnimating(false)}
            onDeliveryComplete={handleDeliveryComplete}
            agvs={agvs}
            amrSpeed={amrSpeed}
          />
          <OrderOverlay
            orders={combinedOrders}
            ordersLoading={combinedOrdersLoading}
            onRefetchOrders={refetchCombinedOrders}
            onExecute={handleCombinedExecute}
            onReset={handleCombinedReset}
            amrSpeed={amrSpeed}
            onAmrSpeedChange={setAmrSpeed}
            completedTimes={orderCompletedTimes}
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

    </div>
  );
}
