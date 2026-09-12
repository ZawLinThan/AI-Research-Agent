import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, client } from "../src/db/index.js";
migrate(db, { migrationsFolder: "backend/drizzle" })
  .then(() => console.log("Migrations applied"))
  .catch((error) => {
    console.error(
      JSON.stringify({
        error: "Migration failed",
        code: error.code,
        cause: error.cause?.code,
        message: error.cause?.message || error.message,
      }),
    );
    process.exitCode = 1;
  })
  .finally(() => client.end());
