import { migrate } from "../migrate.ts";
import { createTempDatabase, TEMPLATE_DATABASE_ENV, TEST_DATABASE_URL } from "./temp-database.ts";

/**
 * Vitest global setup for packages with database tests: migrates one template database for the
 * run, which `createMigratedDatabase` copies per test, and drops it at the end. Test workers
 * inherit its name through the environment.
 */
export default async function setup() {
  if (!TEST_DATABASE_URL) return;
  const template = await createTempDatabase();
  try {
    await migrate({ connectionString: template.url });
  } catch (error) {
    await template.drop();
    throw error;
  }
  process.env[TEMPLATE_DATABASE_ENV] = template.name;
  return async () => {
    delete process.env[TEMPLATE_DATABASE_ENV];
    await template.drop();
  };
}
