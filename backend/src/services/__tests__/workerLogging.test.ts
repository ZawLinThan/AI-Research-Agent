import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkerLogging } from "../../lib/workerLogging.js";

const startedAt = new Date("2026-09-27T12:34:56.789Z");

test("worker output is mirrored, concurrent runs stay separate, and retries append", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worker-logs-"));
  const logging = createWorkerLogging(directory);
  const original = process.stdout.write;
  logging.install();
  logging.install();
  try {
    console.log("worker startup");
    const a = { id: "a", question: "How / do queues work?", startedAt };
    const b = { id: "b", question: a.question, startedAt };
    await Promise.all([
      logging.run(a, async () => {
        console.log("A planner", { queries: ["one", "two"] });
        await new Promise<void>((resolve) => setImmediate(resolve));
        console.warn("A warning");
        process.stdout.write("partial ");
        process.stdout.write("line\n");
        await new Promise<void>((resolve) =>
          process.stderr.write(Buffer.from("A stderr\n"), () => resolve()),
        );
      }),
      logging.run(b, async () => {
        console.error("B failure");
        await Promise.resolve();
        console.info("B info");
      }),
    ]);
    logging.event("a", () => console.error("A attempt failed"));
    logging.release("a");
    logging.run(a, () => console.debug("A retry"));
    logging.event("a", () => console.log("A completed"));
    const files = readdirSync(directory);
    assert.equal(files.length, 3);
    const aFile = files.find((name) => name.endsWith("+a.md"))!;
    assert.match(aFile, /^How-do-queues-work\+2026-09-27T12-34-56-789Z/);
    const aText = readFileSync(join(directory, aFile), "utf8");
    for (const text of [
      "A planner",
      "A warning",
      "partial line",
      "A stderr",
      "A attempt failed",
      "A retry",
      "A completed",
    ]) {
      assert.ok(aText.includes(text), text);
    }

    assert.ok(!aText.includes("B failure"));
    assert.ok(!aText.includes("worker startup"));
    const bText = readFileSync(
      join(
        directory,
        files.find((name) => name.endsWith("+b.md"))!,
      ),
      "utf8",
    );
    assert.match(bText, /B failure/);
    assert.ok(!bText.includes("A planner"));
    const session = readFileSync(logging.sessionFile, "utf8");
    assert.match(session, /worker startup/);
    assert.match(session, /A completed/);
    assert.match(session, /B failure/);
  } finally {
    logging.uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(process.stdout.write, original);
});

test("Unicode and traversal characters produce safe bounded filenames", () => {
  const directory = mkdtempSync(join(tmpdir(), "worker-logs-"));
  const logging = createWorkerLogging(directory);
  logging.install();
  try {
    logging.run(
      { id: "safe-id", question: "../../" + "研究".repeat(100), startedAt },
      () => console.log("unicode question"),
    );
    const file = readdirSync(directory).find(
      (name) => !name.startsWith("worker+"),
    )!;
    assert.ok(Buffer.byteLength(file) < 255);
    assert.ok(!file.includes(".."));
    assert.ok(!file.includes("/"));
  } finally {
    logging.uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("disk logging failures do not break worker output", () => {
  const directory = mkdtempSync(join(tmpdir(), "worker-logs-"));
  const blocked = join(directory, "not-a-directory");
  writeFileSync(blocked, "occupied");
  const logging = createWorkerLogging(blocked);
  logging.install();
  try {
    assert.doesNotThrow(() =>
      logging.run({ id: "run", question: "Question", startedAt }, () =>
        console.log("still on terminal"),
      ),
    );
  } finally {
    logging.uninstall();
    rmSync(directory, { recursive: true, force: true });
  }
});
