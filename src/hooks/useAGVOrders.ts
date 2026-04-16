import { useState, useEffect, useCallback } from "react";
import { buildWarehouseApiUrl } from "@/lib/warehouseApi";

export interface AGVOrder {
  order_id: number;
  type: string;
  agv_id: number;
  from_location: string;
  to_station: string;
}

export type AGVFlowType = "rack-to-station" | "station-to-delivery";

export interface ParsedAGVOrder extends AGVOrder {
  flowType: AGVFlowType;
  // For "station-to-delivery": source packing station index
  sourceStation: number;
  destIsDelivery: boolean;
  // For "rack-to-station": rack slot address + dest packing station
  rackRow?: number;
  rackRack?: number;
  rackDeep?: number;
  rackSlot?: number;
  destStation?: number;
}

function detectFlowType(from_location: string): AGVFlowType {
  // Old format has hyphens: "1-02-2-1" (row-rack-deep-slot)
  return from_location.includes("-") ? "rack-to-station" : "station-to-delivery";
}

const API_URL = buildWarehouseApiUrl({ endpoint: "orders_agv" });

export function useAGVOrders() {
  const [orders, setOrders] = useState<ParsedAGVOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(API_URL, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      const items: AGVOrder[] = Array.isArray(data) ? data : data.items ?? data.orders ?? [];
      const parsed: ParsedAGVOrder[] = items.map((o) => {
        const flowType = detectFlowType(o.from_location);

        if (flowType === "rack-to-station") {
          // "1-02-2-1" → row=1, rack=2, deep=2, slot=1
          const parts = o.from_location.split("-").map((p) => parseInt(p, 10));
          return {
            ...o,
            flowType,
            sourceStation: 1,
            destIsDelivery: false,
            rackRow: parts[0] || 1,
            rackRack: parts[1] || 1,
            rackDeep: parts[2] || 1,
            rackSlot: parts[3] || 1,
            destStation: parseInt(o.to_station, 10) || 1,
          };
        } else {
          // "02" → packing station 2 to delivery area
          return {
            ...o,
            flowType,
            sourceStation: parseInt(o.from_location, 10) || 1,
            destIsDelivery: true,
          };
        }
      });
      setOrders(parsed);
    } catch (err: any) {
      console.error("Failed to fetch AGV orders:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return { orders, loading, error, refetch: fetchOrders };
}
