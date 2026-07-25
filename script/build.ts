import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// Server deps to bundle to reduce openat(2) syscalls (helps cold start)
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("[build] building client (Vite)...");
  try {
    await viteBuild();
  } catch (err: any) {
    // Print a clean error instead of the raw circular-ref object
    // that Node prints when Vite's ESM graph has unresolved cycles.
    const msg = err?.message || String(err);
    console.error("[build] Vite client build failed:", msg);
    process.exit(1);
  }
  console.log("[build] client build complete.");

  console.log("[build] building server (esbuild)...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
  console.log("[build] server build complete.");
}

buildAll().catch((err) => {
  console.error("[build] fatal:", err?.message || err);
  process.exit(1);
});
