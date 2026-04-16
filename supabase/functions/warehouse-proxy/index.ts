import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE = "http://sudarshan.leapmile.com:8000";

const endpointMap: Record<string, string> = {
  agv: "/agv",
  orders: "/orders",
  orders_agv: "/orders/agv",
  orders_shuttle: "/orders/shuttle",
  stores: "/store",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint") || "";
    const id = url.searchParams.get("id") || "1";

    const path = endpointMap[endpoint] ?? `/store/${id}`;

    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
    });

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});