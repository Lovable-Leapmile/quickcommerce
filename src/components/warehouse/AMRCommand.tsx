import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Play, RotateCcw, Plus, Minus, RefreshCw, MapPin } from "lucide-react";
import type { WarehouseParams } from "./WarehouseConfig";
import type { ParsedAGVOrder } from "@/hooks/useAGVOrders";

export interface AMROrder {
  agvId: number;
  sourceStation: number;  // packing station number (source)
  destIsDelivery: boolean; // destination is delivery area
  manualMode?: boolean;
  sourceX?: number;
  sourceY?: number;
  destX?: number;
  destY?: number;
  // Old flow: rack-to-station
  flowType?: "rack-to-station" | "station-to-delivery";
  rackRow?: number;
  rackRack?: number;
  rackDeep?: number;
  rackSlot?: number;
  destStation?: number;
  itemIndex?: number;
}

interface AMRCommandProps {
  params: WarehouseParams;
  onExecute: (order: AMROrder) => void;
  onExecuteBatch?: (orders: AMROrder[]) => void;
  isAnimating: boolean;
  onReset: () => void;
  onStationCountChange: (count: number) => void;
  orders: ParsedAGVOrder[];
  ordersLoading: boolean;
  onRefetchOrders: () => void;
}

export function AMRCommand({ params, onExecute, onExecuteBatch, onReset, onStationCountChange, orders, ordersLoading, onRefetchOrders }: AMRCommandProps) {
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<"orders" | "manual">("orders");
  const [srcX, setSrcX] = useState(0);
  const [srcY, setSrcY] = useState(0);
  const [dstX, setDstX] = useState(0);
  const [dstY, setDstY] = useState(0);

  const stations = params.packingStations ?? 3;

  const toggleOrder = (orderId: number) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedOrderIds.size === orders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(orders.map((o) => o.order_id)));
    }
  };

  const mapOrderToAMR = (order: ParsedAGVOrder): AMROrder => ({
    agvId: order.agv_id,
    sourceStation: order.sourceStation,
    destIsDelivery: order.destIsDelivery,
    flowType: order.flowType,
    rackRow: order.rackRow,
    rackRack: order.rackRack,
    rackDeep: order.rackDeep,
    rackSlot: order.rackSlot,
    destStation: order.destStation,
  });

  const handleSendOrders = () => {
    if (mode === "manual") {
      onExecute({
        agvId: 1,
        sourceStation: 1,
        destIsDelivery: true,
        manualMode: true,
        sourceX: srcX,
        sourceY: srcY,
        destX: dstX,
        destY: dstY,
      });
      return;
    }

    const selectedOrders = orders.filter((order) => selectedOrderIds.has(order.order_id));
    const amrOrders = selectedOrders.map(mapOrderToAMR);

    if (amrOrders.length === 0) return;

    if (amrOrders.length === 1 || !onExecuteBatch) {
      amrOrders.forEach(onExecute);
      return;
    }

    onExecuteBatch(amrOrders);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex gap-1">
          <Button size="sm" variant={mode === "orders" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => setMode("orders")}>
            Orders
          </Button>
          <Button size="sm" variant={mode === "manual" ? "default" : "outline"} className="h-6 px-2 text-[10px]" onClick={() => setMode("manual")}>
            <MapPin className="mr-1 h-3 w-3" />XY
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">Packing Stations</p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => onStationCountChange(Math.max(1, stations - 1))}>
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-6 text-center font-mono text-sm text-foreground">{stations}</span>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => onStationCountChange(Math.min(10, stations + 1))}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {mode === "orders" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-muted-foreground">AGV Orders</p>
              {orders.length > 0 && (
                <button type="button" onClick={selectAll} className="text-[10px] text-accent hover:underline">
                  {selectedOrderIds.size === orders.length ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              {selectedOrderIds.size > 0 && <span className="font-mono text-[10px] text-accent">{selectedOrderIds.size} selected</span>}
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRefetchOrders} disabled={ordersLoading}>
                <RefreshCw className={`h-3 w-3 ${ordersLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {ordersLoading ? (
            <p className="text-xs text-muted-foreground">Loading orders...</p>
          ) : orders.length === 0 ? (
            <p className="text-xs text-muted-foreground">No orders available</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {orders.map((order) => {
                const isSelected = selectedOrderIds.has(order.order_id);

                return (
                  <div
                    key={order.order_id}
                    onClick={() => toggleOrder(order.order_id)}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                      isSelected ? "border-accent/50 bg-accent/30" : "border-transparent bg-muted/50 hover:bg-muted"
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOrder(order.order_id)}
                      className="h-3.5 w-3.5"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-accent">#{order.order_id}</span>
                        <span className="text-muted-foreground">AGV {order.agv_id}</span>
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        {order.from_location} → Station {order.to_station}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Source (X, Y meters)</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">X</Label>
              <Input type="number" step="0.1" value={srcX} onChange={(e) => setSrcX(parseFloat(e.target.value) || 0)} className="h-8 bg-muted font-mono text-xs text-foreground" />
            </div>
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">Y</Label>
              <Input type="number" step="0.1" value={srcY} onChange={(e) => setSrcY(parseFloat(e.target.value) || 0)} className="h-8 bg-muted font-mono text-xs text-foreground" />
            </div>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Destination (X, Y meters)</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">X</Label>
              <Input type="number" step="0.1" value={dstX} onChange={(e) => setDstX(parseFloat(e.target.value) || 0)} className="h-8 bg-muted font-mono text-xs text-foreground" />
            </div>
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">Y</Label>
              <Input type="number" step="0.1" value={dstY} onChange={(e) => setDstY(parseFloat(e.target.value) || 0)} className="h-8 bg-muted font-mono text-xs text-foreground" />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleSendOrders} disabled={mode === "orders" && selectedOrderIds.size === 0} className="flex-1 gap-1.5" size="sm">
          <Play className="h-3.5 w-3.5" />
          Send AMR{mode === "orders" && selectedOrderIds.size > 1 ? `s (${selectedOrderIds.size})` : ""}
        </Button>
        <Button onClick={onReset} variant="outline" size="sm" className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}
