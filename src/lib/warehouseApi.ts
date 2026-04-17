const API_BASE = import.meta.env.VITE_BASE_URL || "http://sudarshan.leapmile.com:8000";

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
