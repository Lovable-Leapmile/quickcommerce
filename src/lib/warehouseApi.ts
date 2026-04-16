const WAREHOUSE_API_BASE = import.meta.env.VITE_WAREHOUSE_API_BASE || "/api/warehouse";

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

  const url = new URL(`${WAREHOUSE_API_BASE}${path}`, window.location.origin);

  if (options.endpoint === "stores" && options.id != null) {
    url.searchParams.set("id", String(options.id));
  }

  return url.toString();
}