import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { registerRoutes } from "./routes.js";
import path from "path";
import { existsSync } from "fs";

const PORT = Number(process.env["PORT"] ?? 3001);
const DIST = path.resolve(process.cwd(), "dashboard/dist");

const app = new Elysia()
  .use(cors({ origin: true }));

// Mount all API routes
registerRoutes(app);

// Serve built dashboard static files (production)
if (existsSync(DIST)) {
  app.get("/assets/*", ({ params }) => {
    const filePath = path.join(DIST, "assets", (params as Record<string, string>)["*"]);
    return Bun.file(filePath);
  });

  // SPA fallback — serve index.html for all non-API routes
  app.get("/*", ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api")) return new Response("Not found", { status: 404 });
    return Bun.file(path.join(DIST, "index.html"));
  });
} else {
  app.get("/", () => "YieldBot API running. Start the Vite dev server for the dashboard.");
}

app.listen(PORT, () => {
  console.log(`\n⚡ YieldBot API running at http://localhost:${PORT}`);
  if (existsSync(DIST)) {
    console.log(`   Dashboard served at http://localhost:${PORT}`);
  } else {
    console.log(`   Dashboard dev server: http://localhost:5173`);
    console.log(`   (Run "npm run dev:ui" to start the Vite dev server)`);
  }
});
