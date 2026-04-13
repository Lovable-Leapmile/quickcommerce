import { useState, useEffect } from "react";

export interface AGVInfo {
  agv_id: number;
  agv_name: string;
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-store?endpoint=agv`;

export function useAGVs() {
  const [agvs, setAgvs] = useState<AGVInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAGVs = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(API_URL, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        const items: AGVInfo[] = data.items ?? [];
        setAgvs(items);
      } catch (err: any) {
        console.error("Failed to fetch AGVs:", err);
        setError(err.message);
        // Default to 1 AMR
        setAgvs([{ agv_id: 1, agv_name: "agv1" }]);
      } finally {
        setLoading(false);
      }
    };
    fetchAGVs();
  }, []);

  return { agvs, loading, error };
}
