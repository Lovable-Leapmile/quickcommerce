// HTTPS -> HTTP proxy so the hosted site can reach the warehouse API
// (browsers block direct HTTP fetches from HTTPS pages — mixed content).
// All data still comes from http://sudarshan.leapmile.com:8000 only.

const BASE = "http://sudarshan.leapmile.com:8000";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Strip the function prefix: /functions/v1/warehouse-proxy/<rest>
    const idx = url.pathname.indexOf("/warehouse-proxy");
    const rest = idx >= 0 ? url.pathname.slice(idx + "/warehouse-proxy".length) : "";
    const target = `${BASE}${rest || "/"}${url.search}`;

    const upstream = await fetch(target, {
      method: req.method,
      headers: { accept: "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
