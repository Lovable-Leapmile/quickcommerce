// All data is fetched from the single backend: http://sudarshan.leapmile.com:8000
// Browsers block HTTP fetches from HTTPS pages (mixed content), so:
//  - In dev, Vite proxy `/api/warehouse` -> backend.
//  - On the hosted HTTPS site, an edge function (warehouse-proxy) forwards to the same backend.
const RAW_BASE = import.meta.env.VITE_BASE_URL || "http://sudarshan.leapmile.com:8000";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

const isBrowserHttps =
  typeof window !== "undefined" && window.location.protocol === "https:";
const isHttpTarget = RAW_BASE.startsWith("http://");

let API_BASE: string;
if (isBrowserHttps && isHttpTarget) {
  API_BASE = SUPABASE_URL
    ? `${SUPABASE_URL}/functions/v1/warehouse-proxy`
    : "/api/warehouse";
} else {
  API_BASE = RAW_BASE;
}

type WarehouseEndpoint = "agv" | "orders" | "orders_agv" | "orders_shuttle" | "stores";

interface WarehouseApiOptions {
  endpoint?: WarehouseEndpoint;
  id?: number | string;
}

const endpointPathMap: Record<WarehouseEndpoint, string> = {
  agv: "/agv",
  orders: "/orders",
  orders_agv: "/orders/agv",
  orders_shuttle: "/orders/shuttle",
  stores: "/store",
};

export function buildWarehouseApiUrl(options: WarehouseApiOptions = {}) {
  const path = options.endpoint
    ? endpointPathMap[options.endpoint]
    : `/store/${options.id ?? 1}`;

  return `${API_BASE}${path}`;
}
