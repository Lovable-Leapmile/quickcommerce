import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE = "http://sudarshan.leapmile.com:8000";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint") || "store";
    const id = url.searchParams.get("id") || "";

    let apiUrl: string;
    if (endpoint === "agv") {
      apiUrl = `${BASE}/agv`;
    } else if (endpoint === "orders_agv") {
      apiUrl = `${BASE}/orders/agv`;
    } else if (endpoint === "orders_shuttle") {
      apiUrl = `${BASE}/orders/shuttle`;
    } else if (endpoint === "orders") {
      apiUrl = `${BASE}/orders`;
    } else {
      apiUrl = `${BASE}/store/${id || "1"}`;
    }

    const res = await fetch(apiUrl, {
      headers: { accept: "application/json" },
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
