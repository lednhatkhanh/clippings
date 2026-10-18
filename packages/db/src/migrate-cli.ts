import { migrate } from "./migrate.ts";

const connectionString = process.env.DATABASE_URL_DIRECT;
if (!connectionString) {
  console.error("DATABASE_URL_DIRECT is not set. Migrations need the database's direct URL.");
  process.exit(1);
}

const applied = await migrate({ connectionString });
console.log(
  applied.length === 0
    ? "No pending migrations."
    : `Applied:\n${applied.map((n) => `  ${n}`).join("\n")}`,
);
