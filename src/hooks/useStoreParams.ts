import { useState, useEffect } from "react";
import type { WarehouseParams } from "@/components/warehouse/WarehouseConfig";

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-store?id=1`;

const defaultParams: WarehouseParams = {
  rows: 2,
  racks: 10,
  deep: 2,
  slotsPerRack: 5,
  length: 6,
  width: 5,
  height: 4,
};

export function useStoreParams() {
  const [params, setParams] = useState<WarehouseParams>(defaultParams);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchParams = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(API_URL, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setParams({
          rows: data.row_number ?? defaultParams.rows,
          racks: data.rack_number ?? defaultParams.racks,
          deep: data.depth_number ?? defaultParams.deep,
          slotsPerRack: data.slot_number ?? defaultParams.slotsPerRack,
          length: data.length ?? defaultParams.length,
          width: data.width ?? defaultParams.width,
          height: data.height ?? defaultParams.height,
        });
      } catch (err: any) {
        console.error("Failed to fetch store params:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchParams();
  }, []);

  return { params, loading, error };
}
