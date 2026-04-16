const PROXY_URL = import.meta.env.VITE_WAREHOUSE_PROXY_URL;

type WarehouseEndpoint = "agv" | "orders" | "orders_agv" | "orders_shuttle" | "stores";

interface WarehouseApiOptions {
  endpoint?: WarehouseEndpoint;
  id?: number | string;
}

export function buildWarehouseApiUrl(options: WarehouseApiOptions = {}) {
  const url = new URL(PROXY_URL);

  if (options.endpoint) {
    url.searchParams.set("endpoint", options.endpoint);
  }

  if (options.id != null) {
    url.searchParams.set("id", String(options.id));
  }

  return url.toString();
}