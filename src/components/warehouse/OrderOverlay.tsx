import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Play, RefreshCw, ChevronDown, ChevronUp, Check } from "lucide-react";
import type { ParsedOrder } from "@/hooks/useOrders";
import type { CombinedExecutionPayload } from "./CombinedMovementCommand";
import type { MovementOrder } from "./MovementCommand";
import type { AMROrder } from "./AMRCommand";

interface OrderOverlayProps {
  orders: ParsedOrder[];
  ordersLoading: boolean;
  onRefetchOrders: () => void;
  onExecute: (payload: CombinedExecutionPayload) => void;
  onReset: () => void;
}

export function OrderOverlay({
  orders,
  ordersLoading,
  onRefetchOrders,
  onExecute,
  onReset,
}: OrderOverlayProps) {
  const [expanded, setExpanded] = useState(true);
  const [agvCounts, setAgvCounts] = useState<Record<number, number>>({});
  const [confirmedOrders, setConfirmedOrders] = useState<Set<number>>(new Set());

  const getAgvCount = (order: ParsedOrder) => agvCounts[order.order_id] ?? 1;

  const setAgvCount = (orderId: number, count: number, maxItems: number) => {
    const clamped = Math.max(1, Math.min(maxItems, count));
    setAgvCounts((prev) => ({ ...prev, [orderId]: clamped }));
  };

  const toggleConfirm = (orderId: number) => {
    setConfirmedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const buildPayload = (): CombinedExecutionPayload => {
    const shuttleOrders: MovementOrder[] = [];
    const amrOrders: AMROrder[] = [];
    let totalAgvCount = 0;

    const selectedOrders = orders.filter((o) => confirmedOrders.has(o.order_id));

    for (const order of selectedOrders) {
      const agvCount = getAgvCount(order);
      totalAgvCount += agvCount;

      const itemsByAgv: Map<number, typeof order.items> = new Map();
      for (let i = 0; i < order.items.length; i++) {
        const agvIdx = i % agvCount;
        if (!itemsByAgv.has(agvIdx)) itemsByAgv.set(agvIdx, []);
        itemsByAgv.get(agvIdx)!.push(order.items[i]);
      }

      itemsByAgv.forEach((items, agvIdx) => {
        const assignedAgvId = agvIdx + 1;
        for (const item of items) {
          shuttleOrders.push({
            source: { row: item.srcRow, rack: item.srcRack, deep: item.srcDeep, slot: item.srcSlot },
            destination: { row: item.dstRow, rack: item.dstRack, deep: item.dstDeep, slot: item.dstSlot },
          });
          amrOrders.push({
            agvId: assignedAgvId,
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
      });
    }

    return { shuttleOrders, amrOrders, agvCount: totalAgvCount };
  };

  const handleExecute = () => {
    const payload = buildPayload();
    if (payload.shuttleOrders.length === 0) return;
    onExecute(payload);
  };

  return (
    <div className="absolute bottom-3 left-3 z-10 max-w-[420px]">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-t border border-border bg-card/95 backdrop-blur-sm text-foreground hover:bg-muted/80"
      >
        Orders
        <span className="text-muted-foreground font-mono">({orders.length})</span>
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0 ml-1"
          onClick={(e) => { e.stopPropagation(); onRefetchOrders(); }}
          disabled={ordersLoading}
        >
          <RefreshCw className={`h-3 w-3 ${ordersLoading ? "animate-spin" : ""}`} />
        </Button>
      </button>

      {expanded && (
        <div className="border border-t-0 border-border rounded-b bg-card/95 backdrop-blur-sm p-2 space-y-1.5 max-h-48 overflow-y-auto">
          {ordersLoading ? (
            <p className="text-[10px] text-muted-foreground px-1">Loading...</p>
          ) : orders.length === 0 ? (
            <p className="text-[10px] text-muted-foreground px-1">No orders</p>
          ) : (
            <>
              {orders.map((order) => {
                const agvCount = getAgvCount(order);
                const isConfirmed = confirmedOrders.has(order.order_id);
                return (
                  <div
                    key={order.order_id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                      isConfirmed ? "bg-accent/15 border border-accent/40" : "bg-muted/40 border border-transparent"
                    }`}
                  >
                    {/* Order info */}
                    <span className="font-semibold text-accent whitespace-nowrap">#{order.order_id}</span>
                    <span className="text-muted-foreground whitespace-nowrap">{order.number_of_items}items</span>

                    {/* Divider */}
                    <span className="text-border">|</span>

                    {/* AGV selector */}
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">AGV</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="w-5 h-5 flex items-center justify-center rounded border border-border bg-background hover:bg-muted text-foreground"
                        onClick={() => setAgvCount(order.order_id, agvCount - 1, order.number_of_items)}
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <span className="w-4 text-center text-[10px] font-bold text-foreground">{agvCount}</span>
                      <button
                        type="button"
                        className="w-5 h-5 flex items-center justify-center rounded border border-border bg-background hover:bg-muted text-foreground"
                        onClick={() => setAgvCount(order.order_id, agvCount + 1, order.number_of_items)}
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>

                    {/* OK button */}
                    <Button
                      size="sm"
                      variant={isConfirmed ? "default" : "outline"}
                      className="h-5 px-2 text-[10px] gap-0.5 ml-auto"
                      onClick={() => toggleConfirm(order.order_id)}
                    >
                      <Check className="h-2.5 w-2.5" />
                      {isConfirmed ? "Ready" : "OK"}
                    </Button>
                  </div>
                );
              })}

              {/* Execute / Reset row */}
              {confirmedOrders.size > 0 && (
                <div className="flex gap-1.5 pt-1">
                  <Button size="sm" className="flex-1 h-7 text-xs gap-1" onClick={handleExecute}>
                    <Play className="h-3 w-3" />
                    Execute ({confirmedOrders.size})
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReset}>
                    Reset
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
