import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Play, RotateCcw, RefreshCw, MapPin } from "lucide-react";
import type { WarehouseParams } from "./WarehouseConfig";
import type { ParsedShuttleOrder } from "@/hooks/useShuttleOrders";

export interface SlotAddress {
  row: number;
  deep: number;
  rack: number;
  slot: number;
}

export interface MovementOrder {
  source: SlotAddress;
  destination: SlotAddress;
}

/** Derive aisle index (0-based) and side ("top"|"bottom") from row (1-based) */
export function rowToAisleSide(row: number): { aisleIdx: number; side: "top" | "bottom" } {
  const aisleIdx = Math.floor((row - 1) / 2);
  const side: "top" | "bottom" = row % 2 === 1 ? "top" : "bottom";
  return { aisleIdx, side };
}

interface MovementCommandProps {
  params: WarehouseParams;
  onExecute: (order: MovementOrder) => void;
  onExecuteBatch: (orders: MovementOrder[]) => void;
  isAnimating: boolean;
  onReset: () => void;
  shuttleOrders: ParsedShuttleOrder[];
  shuttleOrdersLoading: boolean;
  onRefetchShuttleOrders: () => void;
}

function SlotInputGroup({
  label,
  value,
  onChange,
  params,
}: {
  label: string;
  value: SlotAddress;
  onChange: (addr: SlotAddress) => void;
  params: WarehouseParams;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-accent uppercase tracking-wider">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground block mb-1">Row</Label>
          <Input
            type="number"
            min={1}
            max={params.rows}
            value={value.row}
            onChange={(e) =>
              onChange({ ...value, row: Math.max(1, Math.min(params.rows, parseInt(e.target.value) || 1)) })
            }
            className="bg-muted border-border text-foreground font-mono h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground block mb-1">Rack</Label>
          <Input
            type="number"
            min={1}
            max={params.racks}
            value={value.rack}
            onChange={(e) =>
              onChange({ ...value, rack: Math.max(1, Math.min(params.racks, parseInt(e.target.value) || 1)) })
            }
            className="bg-muted border-border text-foreground font-mono h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground block mb-1">Deep</Label>
          <Input
            type="number"
            min={1}
            max={params.deep}
            value={value.deep}
            onChange={(e) =>
              onChange({ ...value, deep: Math.max(1, Math.min(params.deep, parseInt(e.target.value) || 1)) })
            }
            className="bg-muted border-border text-foreground font-mono h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground block mb-1">Slot (Level)</Label>
          <Input
            type="number"
            min={1}
            max={params.slotsPerRack}
            value={value.slot}
            onChange={(e) =>
              onChange({ ...value, slot: Math.max(1, Math.min(params.slotsPerRack, parseInt(e.target.value) || 1)) })
            }
            className="bg-muted border-border text-foreground font-mono h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

export function MovementCommand({ params, onExecute, onExecuteBatch, isAnimating, onReset, shuttleOrders, shuttleOrdersLoading, onRefetchShuttleOrders }: MovementCommandProps) {
  const [source, setSource] = useState<SlotAddress>({ row: 1, deep: 1, rack: 1, slot: 1 });
  const [destination, setDestination] = useState<SlotAddress>({ row: 1, deep: 1, rack: 2, slot: 1 });
  const [mode, setMode] = useState<"orders" | "manual">("orders");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());

  const toggleOrder = (id: number) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExecute = () => {
    if (mode === "manual") {
      onExecute({ source, destination });
      return;
    }
    const selected = shuttleOrders.filter((o) => selectedOrderIds.has(o.order_id));
    if (selected.length === 0) return;
    const orders: MovementOrder[] = selected.map((o) => ({
      source: { row: o.sourceRow, rack: o.sourceRack, deep: o.sourceDeep, slot: o.sourceSlot },
      destination: { row: o.destRow, rack: o.destRack, deep: o.destDeep, slot: o.destSlot },
    }));
    onExecuteBatch(orders);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex gap-1">
          <Button
            size="sm" variant={mode === "orders" ? "default" : "outline"}
            className="h-6 text-[10px] px-2" onClick={() => setMode("orders")}
          >Orders</Button>
          <Button
            size="sm" variant={mode === "manual" ? "default" : "outline"}
            className="h-6 text-[10px] px-2" onClick={() => setMode("manual")}
          >
            <MapPin className="w-3 h-3 mr-1" />Manual
          </Button>
        </div>
      </div>

      {mode === "orders" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">
              Shuttle Orders {selectedOrderIds.size > 0 && `(${selectedOrderIds.size} selected)`}
            </p>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRefetchShuttleOrders} disabled={shuttleOrdersLoading}>
              <RefreshCw className={`w-3 h-3 ${shuttleOrdersLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {shuttleOrdersLoading ? (
            <p className="text-xs text-muted-foreground">Loading orders...</p>
          ) : shuttleOrders.length === 0 ? (
            <p className="text-xs text-muted-foreground">No orders available</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {shuttleOrders.map((o) => (
                <div
                  key={o.order_id}
                  onClick={() => toggleOrder(o.order_id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors cursor-pointer flex items-start gap-2 ${
                    selectedOrderIds.has(o.order_id)
                      ? "bg-accent/30 border border-accent/50"
                      : "bg-muted/50 border border-transparent hover:bg-muted"
                  }`}
                >
                  <Checkbox
                    checked={selectedOrderIds.has(o.order_id)}
                    onCheckedChange={() => toggleOrder(o.order_id)}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="text-accent font-semibold">#{o.order_id}</span>
                      <span className="text-muted-foreground">{o.type}</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {o.from_location} → {o.to_location}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <SlotInputGroup label="Source" value={source} onChange={setSource} params={params} />
          <SlotInputGroup label="Destination" value={destination} onChange={setDestination} params={params} />
        </>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleExecute}
          disabled={isAnimating || (mode === "orders" && selectedOrderIds.size === 0)}
          className="flex-1 gap-1.5" size="sm"
        >
          <Play className="w-3.5 h-3.5" />
          {isAnimating ? "Moving..." : `Execute${mode === "orders" && selectedOrderIds.size > 1 ? ` (${selectedOrderIds.size})` : ""}`}
        </Button>
        <Button onClick={onReset} variant="outline" size="sm" className="gap-1.5">
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}
