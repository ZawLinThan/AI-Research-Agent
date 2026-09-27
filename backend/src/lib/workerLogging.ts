import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

export type RunLog = { id: string; question: string; startedAt: Date };

export function createWorkerLogging(directory: string) {
  const context = new AsyncLocalStorage<string>();
  const runFiles = new Map<string, string>();
  const continuedLines = new Set<string>();
  let installed = false;
  let warned = false;
  const originalOut = process.stdout.write;
  const originalError = process.stderr.write;
  const timestamp = (date: Date) => date.toISOString().replace(/[:.]/g, "-");
  const sessionFile = resolve(
    directory,
    `worker+${timestamp(new Date())}+${process.pid}.md`,
  );

  const append = (file: string, text: string) => {
    try {
      mkdirSync(directory, { recursive: true });
      // Indented Markdown preserves multiline objects, stacks and literal backticks.
      const clean = stripVTControlCharacters(text);
      if (!clean) return;
      const prefix = continuedLines.has(file) ? "" : "    ";
      appendFileSync(file, prefix + clean.replace(/\n(?=.)/g, "\n    "), {
        mode: 0o600,
      });
      if (clean.endsWith("\n")) continuedLines.delete(file);
      else continuedLines.add(file);
    } catch (error) {
      if (!warned) {
        warned = true;
        originalError.call(
          process.stderr,
          `Worker file logging failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  };

  const capture = (chunk: string | Uint8Array, encoding?: BufferEncoding) => {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(encoding);
    append(sessionFile, text);
    const file = context.getStore();
    if (file) append(file, text);
  };

  return {
    sessionFile,
    install() {
      if (installed) return;
      installed = true;
      process.stdout.write = function (
        this: typeof process.stdout,
        chunk: string | Uint8Array,
        ...args: any[]
      ) {
        capture(
          chunk,
          typeof args[0] === "string" ? (args[0] as BufferEncoding) : undefined,
        );
        return originalOut.call(this, chunk, ...(args as [any]));
      } as typeof process.stdout.write;
      process.stderr.write = function (
        this: typeof process.stderr,
        chunk: string | Uint8Array,
        ...args: any[]
      ) {
        capture(
          chunk,
          typeof args[0] === "string" ? (args[0] as BufferEncoding) : undefined,
        );
        return originalError.call(this, chunk, ...(args as [any]));
      } as typeof process.stderr.write;
    },
    uninstall() {
      if (!installed) return;
      process.stdout.write = originalOut;
      process.stderr.write = originalError;
      installed = false;
    },
    run<T>(run: RunLog, action: () => T): T {
      // Bound by UTF-8 bytes so Unicode questions also fit filesystem limits.
      let slug = "";
      for (const char of run.question
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}_-]+/gu, " ")
        .trim()
        .replace(/\s+/g, "-")) {
        if (Buffer.byteLength(slug + char) > 120) break;
        slug += char;
      }
      const safeId = run.id.replace(/[^a-zA-Z0-9-]/g, "");
      const file = resolve(
        directory,
        `${slug || "question"}+${timestamp(run.startedAt)}+${safeId}.md`,
      );
      runFiles.set(run.id, file);
      return context.run(file, action);
    },
    event<T>(id: string | undefined, action: () => T): T {
      const file = id ? runFiles.get(id) : undefined;
      return file ? context.run(file, action) : action();
    },
    release(id: string) {
      runFiles.delete(id);
    },
  };
}

export const workerLogging = createWorkerLogging(
  resolve(__dirname, "../../../logs"),
);
