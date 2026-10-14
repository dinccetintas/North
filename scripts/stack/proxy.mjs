#!/usr/bin/env node
/**
 * The API gateway the Supabase CLI runs as Kong, in forty lines: one port
 * (54321) that forwards /auth/v1, /rest/v1 and /storage/v1 to GoTrue,
 * PostgREST and the storage API, stripping the prefix. Local use only.
 */
import http from "node:http";

const PORT = Number(process.env.STACK_API_PORT ?? 54321);
const ROUTES = [
  { prefix: "/auth/v1", port: Number(process.env.STACK_AUTH_PORT ?? 9999) },
  { prefix: "/rest/v1", port: Number(process.env.STACK_REST_PORT ?? 54329) },
  { prefix: "/storage/v1", port: Number(process.env.STACK_STORAGE_PORT ?? 5000) },
];

const server = http.createServer((req, res) => {
  const route = ROUTES.find((r) => req.url === r.prefix || req.url.startsWith(`${r.prefix}/`) || req.url.startsWith(`${r.prefix}?`));
  if (!route) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `no route for ${req.url}` }));
    return;
  }
  const path = req.url.slice(route.prefix.length) || "/";
  const upstream = http.request(
    { host: "127.0.0.1", port: route.port, method: req.method, path, headers: { ...req.headers, host: `127.0.0.1:${route.port}` } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `upstream ${route.prefix} unavailable: ${error.message}` }));
  });
  req.pipe(upstream);
});

server.listen(PORT, "127.0.0.1", () => console.log(`[stack-proxy] http://127.0.0.1:${PORT} → ${ROUTES.map((r) => `${r.prefix}:${r.port}`).join(" ")}`));
