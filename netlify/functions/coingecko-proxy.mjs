/**
 * Server-side CoinGecko proxy — secrets stay in Netlify env (never bundled for the browser).
 *
 * Env (Netlify UI / CLI, not VITE_*):
 * - COINGECKO_PRO_API_KEY — Pro key for /api/v3/onchain (charts)
 * - COINGECKO_DEMO_API_KEY — optional Demo key for /api/v3/simple/price (higher rate limits)
 *
 * Query:
 * - kind=pro|demo
 * - p=<url-encoded path including query string, e.g. /api/v3/onchain/networks/...?page=1>
 */

const PRO_ORIGIN = "https://pro-api.coingecko.com";
const DEMO_ORIGIN = "https://api.coingecko.com";
const ALLOWED_PRO_PREFIX = "/api/v3/onchain";
const ALLOWED_DEMO_PREFIX = "/api/v3/simple/price";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

export const handler = async (event) => {
  const method = event.httpMethod || "GET";
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: {}, body: "" };
  }
  if (method !== "GET" && method !== "HEAD") {
    return json(405, { error: "Method not allowed" });
  }

  const kind = String(event.queryStringParameters?.kind || "").toLowerCase();
  const rawP = event.queryStringParameters?.p;
  if (!rawP) {
    return json(400, { error: "Missing query parameter: p" });
  }

  let pathWithQuery;
  try {
    pathWithQuery = decodeURIComponent(rawP);
  } catch {
    return json(400, { error: "Invalid parameter: p (decode error)" });
  }
  if (!pathWithQuery.startsWith("/")) {
    pathWithQuery = `/${pathWithQuery}`;
  }

  const qIdx = pathWithQuery.indexOf("?");
  const pathname = qIdx === -1 ? pathWithQuery : pathWithQuery.slice(0, qIdx);
  const search = qIdx === -1 ? "" : pathWithQuery.slice(qIdx);

  if (kind === "pro") {
    const key = process.env.COINGECKO_PRO_API_KEY?.trim();
    if (!key) {
      return json(503, { error: "COINGECKO_PRO_API_KEY is not configured" });
    }
    if (!pathname.startsWith(ALLOWED_PRO_PREFIX)) {
      return json(403, { error: "Path not allowed for Pro proxy" });
    }
    const target = `${PRO_ORIGIN}${pathname}${search}`;
    const res = await fetch(target, {
      method: method === "HEAD" ? "HEAD" : "GET",
      headers: {
        accept: "application/json",
        "x-cg-pro-api-key": key,
      },
    });
    const text = await res.text();
    const ct = res.headers.get("content-type") || "application/json; charset=utf-8";
    return {
      statusCode: res.status,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "no-store",
      },
      body: text,
    };
  }

  if (kind === "demo") {
    if (!pathname.startsWith(ALLOWED_DEMO_PREFIX)) {
      return json(403, { error: "Path not allowed for Demo proxy" });
    }
    const demoKey = process.env.COINGECKO_DEMO_API_KEY?.trim();
    const target = `${DEMO_ORIGIN}${pathname}${search}`;
    const headers = { accept: "application/json" };
    if (demoKey) headers["x-cg-demo-api-key"] = demoKey;
    const res = await fetch(target, {
      method: method === "HEAD" ? "HEAD" : "GET",
      headers,
    });
    const text = await res.text();
    const ct = res.headers.get("content-type") || "application/json; charset=utf-8";
    return {
      statusCode: res.status,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "no-store",
      },
      body: text,
    };
  }

  return json(400, { error: "kind must be pro or demo" });
};
