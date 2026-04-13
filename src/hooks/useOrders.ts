import { useState, useEffect, useCallback } from "react";

export interface OrderItem {
  from_location: string; // "row-rack-deep-slot"
  to_location: string;   // "row-rack-deep-slot"
  packing_location: string; // "station-slot" e.g. "1-05"
}

export interface CombinedOrder {
  order_id: number;
  number_of_items: number;
  items: OrderItem[];
}

export interface ParsedOrderItem extends OrderItem {
  // Parsed from_location
  srcRow: number;
  srcRack: number;
  srcDeep: number;
  srcSlot: number;
  // Parsed to_location
  dstRow: number;
  dstRack: number;
  dstDeep: number;
  dstSlot: number;
  // Parsed packing_location
  packingStation: number;
  packingSlot: number;
}

export interface ParsedOrder {
  order_id: number;
  number_of_items: number;
  items: ParsedOrderItem[];
}

function parseLoc(loc: string) {
  const parts = loc.split("-").map((p) => parseInt(p, 10));
  return {
    row: parts[0] ?? 1,
    rack: parts[1] ?? 1,
    deep: parts[2] ?? 1,
    slot: parts[3] ?? 1,
  };
}

function parsePackingLoc(loc: string) {
  const parts = loc.split("-").map((p) => parseInt(p, 10));
  return {
    station: parts[0] ?? 1,
    slot: parts[1] ?? 1,
  };
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-store?endpoint=orders`;

export function useOrders() {
  const [orders, setOrders] = useState<ParsedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(API_URL, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      const items: CombinedOrder[] = Array.isArray(data) ? data : data.items ?? [];
      const parsed: ParsedOrder[] = items.map((o) => ({
        order_id: o.order_id,
        number_of_items: o.number_of_items,
        items: (o.items || []).map((item) => {
          const src = parseLoc(item.from_location);
          const dst = parseLoc(item.to_location);
          const packing = parsePackingLoc(item.packing_location);
          return {
            ...item,
            srcRow: src.row,
            srcRack: src.rack,
            srcDeep: src.deep,
            srcSlot: src.slot,
            dstRow: dst.row,
            dstRack: dst.rack,
            dstDeep: dst.deep,
            dstSlot: dst.slot,
            packingStation: packing.station,
            packingSlot: packing.slot,
          };
        }),
      }));
      setOrders(parsed);
    } catch (err: any) {
      console.error("Failed to fetch orders:", err);
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
