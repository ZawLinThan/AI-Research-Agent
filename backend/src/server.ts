import { app } from "./app.js";
import { env } from "./config/env.js";
import { researchQueue, producerConnection } from "./queues/research.queue.js";
import { client } from "./db/index.js";

const server = app.listen(env.PORT, "127.0.0.1", () =>
  console.log(`Research API listening on ${env.PORT}`),
);

async function shutdown() {
  server.close();
  await researchQueue.close();
  await producerConnection.quit();
  await client.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
