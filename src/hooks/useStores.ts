import { useState, useEffect } from "react";

export interface StoreItem {
  store_id: number;
  store_name: string;
  row_number: number;
  rack_number: number;
  slot_number: number;
  depth_number: number;
  length: number;
  width: number;
  height: number;
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-store?endpoint=stores`;

export function useStores() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStores = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(API_URL, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setStores(data.items ?? []);
      } catch (err: any) {
        console.error("Failed to fetch stores:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchStores();
  }, []);

  return { stores, loading, error };
}
