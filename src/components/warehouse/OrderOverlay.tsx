import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Check, ChevronDown, Zap } from "lucide-react";
import type { ParsedOrder } from "@/hooks/useOrders";
import type { CombinedExecutionPayload } from "./CombinedMovementCommand";
import type { MovementOrder } from "./MovementCommand";
import type { AMROrder } from "./AMRCommand";

const AMR_SPEEDS = [
  { label: "0.5 m/s", value: 0.5 },
  { label: "1 m/s", value: 1 },
  { label: "1.5 m/s", value: 1.5 },
];

interface OrderOverlayProps {
  orders: ParsedOrder[];
  ordersLoading: boolean;
  onRefetchOrders: () => void;
  onExecute: (payload: CombinedExecutionPayload) => void;
  onReset: () => void;
  amrSpeed: number;
  onAmrSpeedChange: (speed: number) => void;
  completedTimes?: Record<number, number>;
}

export function OrderOverlay({
  orders,
  ordersLoading,
  onExecute,
  amrSpeed,
  onAmrSpeedChange,
  completedTimes = {},
}: OrderOverlayProps) {
  const [agvCounts, setAgvCounts] = useState<Record<number, number>>({});
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);

  const getAgvCount = (order: ParsedOrder) => agvCounts[order.order_id] ?? 1;

  const setAgvCount = (orderId: number, count: number, maxItems: number) => {
    const clamped = Math.max(1, Math.min(maxItems, count));
    setAgvCounts((prev) => ({ ...prev, [orderId]: clamped }));
  };

  // Close speed dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const buildAndExecute = (order: ParsedOrder) => {
    const agvCount = getAgvCount(order);
    const shuttleOrders: MovementOrder[] = [];
    const amrOrders: AMROrder[] = [];

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

    onExecute({ shuttleOrders, amrOrders, agvCount, orderId: order.order_id });
  };

  if (ordersLoading || orders.length === 0) return null;

  return (
    <div className="absolute top-3 left-3 z-10 flex items-start gap-2">
      {/* AMR Speed selector */}
      <div ref={speedRef} className="relative">
        <button
          type="button"
          onClick={() => setSpeedOpen(!speedOpen)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono bg-card/90 border border-border backdrop-blur-sm text-foreground hover:bg-muted/80 transition-colors"
        >
          <Zap className="h-3 w-3 text-accent" />
          <span className="text-muted-foreground">AGV</span>
          <span className="font-semibold">{amrSpeed} m/s</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
        {speedOpen && (
          <div className="absolute top-full mt-1 right-0 bg-card border border-border rounded shadow-lg backdrop-blur-sm z-20 min-w-[120px]">
            {AMR_SPEEDS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => { onAmrSpeedChange(s.value); setSpeedOpen(false); }}
                className={`flex items-center justify-between w-full px-3 py-1.5 text-xs font-mono hover:bg-muted/60 transition-colors ${
                  amrSpeed === s.value ? "text-accent" : "text-foreground"
                }`}
              >
                <span>{s.label}</span>
                {amrSpeed === s.value && <Check className="h-3 w-3 text-accent" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Order lines */}
      <div className="space-y-1">
        {orders.map((order) => {
          const agvCount = getAgvCount(order);
          return (
            <div
              key={order.order_id}
              className="flex items-center gap-2 px-2.5 py-1 rounded text-xs font-mono backdrop-blur-sm bg-card/90 border border-border transition-colors"
            >
              <span className="font-semibold text-accent whitespace-nowrap">#{order.order_id}</span>
              <span className="text-muted-foreground whitespace-nowrap">{order.number_of_items} items</span>
              <span className="text-border">|</span>
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
              <Button
                size="sm"
                className="h-5 px-2 text-[10px] gap-0.5 ml-auto"
                onClick={() => buildAndExecute(order)}
              >
                <Check className="h-2.5 w-2.5" />
                OK
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
