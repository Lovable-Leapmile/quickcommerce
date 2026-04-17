// All data is fetched from the single backend: http://sudarshan.leapmile.com:8000
// In the HTTPS preview, browsers block direct HTTP calls (mixed content),
// so dev mode routes through Vite's proxy which forwards to the SAME server.
const RAW_BASE = import.meta.env.VITE_BASE_URL || "http://sudarshan.leapmile.com:8000";

const isBrowserHttps =
  typeof window !== "undefined" && window.location.protocol === "https:";
const isHttpTarget = RAW_BASE.startsWith("http://");

// Use Vite proxy only when needed (HTTPS page calling HTTP API). Same backend either way.
const API_BASE = isBrowserHttps && isHttpTarget ? "/api/warehouse" : RAW_BASE;

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
