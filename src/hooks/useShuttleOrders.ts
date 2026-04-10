import { useState, useEffect, useCallback } from "react";

export interface ShuttleOrder {
  order_id: number;
  type: string;
  from_location: string; // "row-rack-deep-slot"
  to_location: string;   // "row-rack-deep-slot"
}

export interface ParsedShuttleOrder extends ShuttleOrder {
  sourceRow: number;
  sourceRack: number;
  sourceDeep: number;
  sourceSlot: number;
  destRow: number;
  destRack: number;
  destDeep: number;
  destSlot: number;
}

function parseLocation(loc: string): { row: number; rack: number; deep: number; slot: number } {
  const parts = loc.split("-").map((p) => parseInt(p, 10));
  return {
    row: parts[0] ?? 1,
    rack: parts[1] ?? 1,
    deep: parts[2] ?? 1,
    slot: parts[3] ?? 1,
  };
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-store?endpoint=orders_shuttle`;

export function useShuttleOrders() {
  const [orders, setOrders] = useState<ParsedShuttleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(API_URL, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      const items: ShuttleOrder[] = Array.isArray(data) ? data : data.items ?? data.orders ?? [];
      const parsed: ParsedShuttleOrder[] = items.map((o) => {
        const src = parseLocation(o.from_location);
        const dst = parseLocation(o.to_location);
        return {
          ...o,
          sourceRow: src.row,
          sourceRack: src.rack,
          sourceDeep: src.deep,
          sourceSlot: src.slot,
          destRow: dst.row,
          destRack: dst.rack,
          destDeep: dst.deep,
          destSlot: dst.slot,
        };
      });
      setOrders(parsed);
    } catch (err: any) {
      console.error("Failed to fetch shuttle orders:", err);
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
