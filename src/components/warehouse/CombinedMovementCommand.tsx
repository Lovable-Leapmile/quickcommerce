import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Play, RotateCcw, RefreshCw, ChevronRight, Minus, Plus } from "lucide-react";
import type { WarehouseParams } from "./WarehouseConfig";
import type { ParsedOrder, ParsedOrderItem } from "@/hooks/useOrders";
import type { MovementOrder } from "./MovementCommand";
import type { AMROrder } from "./AMRCommand";

export interface CombinedExecutionPayload {
  shuttleOrders: MovementOrder[];
  amrOrders: AMROrder[];
  agvCount: number;
}

interface CombinedMovementCommandProps {
  params: WarehouseParams;
  orders: ParsedOrder[];
  ordersLoading: boolean;
  onRefetchOrders: () => void;
  onExecute: (payload: CombinedExecutionPayload) => void;
  onReset: () => void;
  onStationCountChange: (count: number) => void;
  onAgvSelectionChange?: (orderId: number, count: number) => void;
}

export function CombinedMovementCommand({
  params,
  orders,
  ordersLoading,
  onRefetchOrders,
  onExecute,
  onReset,
  onStationCountChange,
  onAgvSelectionChange,
}: CombinedMovementCommandProps) {
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<number>>(new Set());
  const [agvCounts, setAgvCounts] = useState<Record<number, number>>({});

  const stations = params.packingStations ?? 3;

  const toggleOrder = (orderId: number) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleExpanded = (orderId: number) => {
    setExpandedOrderIds((prev) => {
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

  const getAgvCount = (order: ParsedOrder) => {
    return agvCounts[order.order_id] ?? 1;
  };

  const setAgvCount = (orderId: number, count: number, maxItems: number) => {
    const clamped = Math.max(1, Math.min(maxItems, count));
    setAgvCounts((prev) => ({ ...prev, [orderId]: clamped }));
    onAgvSelectionChange?.(orderId, clamped);
  };

  const buildPayload = (): CombinedExecutionPayload => {
    const shuttleOrders: MovementOrder[] = [];
    const amrOrders: AMROrder[] = [];
    let totalAgvCount = 0;

    const selectedOrders = orders.filter((o) => selectedOrderIds.has(o.order_id));

    for (const order of selectedOrders) {
      const agvCount = getAgvCount(order);
      totalAgvCount += agvCount;

      for (const item of order.items) {
        // Shuttle: from_location → to_location
        shuttleOrders.push({
          source: { row: item.srcRow, rack: item.srcRack, deep: item.srcDeep, slot: item.srcSlot },
          destination: { row: item.dstRow, rack: item.dstRack, deep: item.dstDeep, slot: item.dstSlot },
        });

        // AGV: to_location → packing_location
        amrOrders.push({
          agvId: 1, // Will be assigned dynamically
          sourceStation: item.packingStation,
          destIsDelivery: false,
          flowType: "rack-to-station",
          rackRow: item.dstRow,
          rackRack: item.dstRack,
          rackDeep: item.dstDeep,
          rackSlot: item.dstSlot,
          destStation: item.packingStation,
        });
      }
    }

    return { shuttleOrders, amrOrders, agvCount: totalAgvCount };
  };

  const handleSend = () => {
    const payload = buildPayload();
    if (payload.shuttleOrders.length === 0) return;
    onExecute(payload);
  };

  return (
    <div className="space-y-4">
      {/* Packing Stations */}
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

      {/* Orders List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Orders</p>
            {orders.length > 0 && (
              <button type="button" onClick={selectAll} className="text-[10px] text-accent hover:underline">
                {selectedOrderIds.size === orders.length ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {selectedOrderIds.size > 0 && (
              <span className="font-mono text-[10px] text-accent">{selectedOrderIds.size} selected</span>
            )}
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
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {orders.map((order) => {
              const isSelected = selectedOrderIds.has(order.order_id);
              const isExpanded = expandedOrderIds.has(order.order_id);
              const agvCount = getAgvCount(order);

              return (
                <div
                  key={order.order_id}
                  className={`rounded border text-xs transition-colors ${
                    isSelected ? "border-accent/50 bg-accent/10" : "border-transparent bg-muted/50"
                  }`}
                >
                  {/* Order Header */}
                  <div
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/80"
                    onClick={() => toggleOrder(order.order_id)}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOrder(order.order_id)}
                      className="h-3.5 w-3.5"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      className="p-0.5"
                      onClick={(e) => { e.stopPropagation(); toggleExpanded(order.order_id); }}
                    >
                      <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </button>
                    <div className="flex-1 flex items-center justify-between font-mono">
                      <span className="font-semibold text-accent">Order #{order.order_id}</span>
                      <span className="text-muted-foreground">{order.number_of_items} items</span>
                    </div>
                  </div>

                  {/* AGV Count Selector (visible when selected) */}
                  {isSelected && (
                    <div className="flex items-center justify-between px-2 py-1 border-t border-border/50 bg-muted/30">
                      <span className="text-[10px] text-muted-foreground">AGVs to assign</span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm" variant="outline" className="h-5 w-5 p-0"
                          onClick={(e) => { e.stopPropagation(); setAgvCount(order.order_id, agvCount - 1, order.number_of_items); }}
                        >
                          <Minus className="h-2.5 w-2.5" />
                        </Button>
                        <span className="w-5 text-center font-mono text-[10px] font-semibold text-foreground">{agvCount}</span>
                        <Button
                          size="sm" variant="outline" className="h-5 w-5 p-0"
                          onClick={(e) => { e.stopPropagation(); setAgvCount(order.order_id, agvCount + 1, order.number_of_items); }}
                        >
                          <Plus className="h-2.5 w-2.5" />
                        </Button>
                        <span className="text-[9px] text-muted-foreground ml-1">/ {order.number_of_items}</span>
                      </div>
                    </div>
                  )}

                  {/* Expanded Items */}
                  {isExpanded && (
                    <div className="px-2 pb-1.5 space-y-1 border-t border-border/30">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="pl-6 py-1 font-mono text-[10px] text-muted-foreground space-y-0.5">
                          <div className="flex gap-2">
                            <span className="text-foreground/70">Item {idx + 1}</span>
                          </div>
                          <div>
                            <span className="text-accent/70">Shuttle:</span>{" "}
                            {item.from_location} → {item.to_location}
                          </div>
                          <div>
                            <span className="text-primary/70">AGV:</span>{" "}
                            {item.to_location} → Packing {item.packing_location}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button onClick={handleSend} disabled={selectedOrderIds.size === 0} className="flex-1 gap-1.5" size="sm">
          <Play className="h-3.5 w-3.5" />
          Execute{selectedOrderIds.size > 0 ? ` (${selectedOrderIds.size})` : ""}
        </Button>
        <Button onClick={onReset} variant="outline" size="sm" className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}
