import { useState, useEffect } from "react";
import { buildWarehouseApiUrl } from "@/lib/warehouseApi";

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

const API_URL = buildWarehouseApiUrl({ endpoint: "stores" });

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

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await res.text();
          const isHtmlResponse = text.trimStart().startsWith("<!doctype") || text.trimStart().startsWith("<html");
          throw new Error(
            isHtmlResponse
              ? "API endpoint returned HTML instead of JSON."
              : "API endpoint returned an invalid response.",
          );
        }

        const data = await res.json();

        if (Array.isArray(data.items)) {
          setStores(data.items);
        } else if (data.store_id) {
          setStores([data]);
        } else {
          setStores([]);
        }
      } catch (err: any) {
        console.error("Failed to fetch stores:", err);
        setStores([]);
        setError(err?.message || "Failed to load stores.");
      } finally {
        setLoading(false);
      }
    };

    fetchStores();
  }, []);

  return { stores, loading, error };
}
