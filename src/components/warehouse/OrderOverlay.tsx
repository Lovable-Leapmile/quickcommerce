import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Check } from "lucide-react";
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
  onExecute,
  onReset,
}: OrderOverlayProps) {
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

  if (ordersLoading || orders.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-3 z-10 space-y-1">
      {orders.map((order) => {
        const agvCount = getAgvCount(order);
        const isConfirmed = confirmedOrders.has(order.order_id);
        return (
          <div
            key={order.order_id}
            className={`flex items-center gap-2 px-2.5 py-1 rounded text-xs font-mono backdrop-blur-sm transition-colors ${
              isConfirmed
                ? "bg-accent/15 border border-accent/40"
                : "bg-card/90 border border-border"
            }`}
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
    </div>
  );
}
