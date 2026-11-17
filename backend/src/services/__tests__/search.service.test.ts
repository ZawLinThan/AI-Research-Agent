import assert from "node:assert/strict";
import { test, mock } from "node:test";
import Exa from "exa-js";
import { searchWeb, extractWeb } from "../search.service.js";

test("search uses auto retrieval and preserves source highlights", async () => {
  const original = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  const response = {
    requestId: "test",
    results: [
      { title: "Source", url: "https://example.com", highlights: ["Evidence"] },
    ],
  };
  const call = mock.method(Exa.prototype, "search", async () => response);
  try {
    assert.deepEqual(await searchWeb("  research topic  "), response);
    assert.deepEqual(call.mock.calls[0].arguments, [
      "research topic",
      { type: "auto", numResults: 5, contents: { highlights: true } },
    ]);
  } finally {
    call.mock.restore();
    if (original === undefined) {
      delete process.env.EXA_API_KEY;
    } else {
      process.env.EXA_API_KEY = original;
    }
  }
});

test("extraction deduplicates URLs and preserves partial failure statuses", async () => {
  const original = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  const response = {
    results: [],
    statuses: [{ id: "https://example.com", status: "error" }],
  };
  const call = mock.method(Exa.prototype, "getContents", async () => response);
  try {
    assert.deepEqual(
      await extractWeb(["https://example.com", "https://example.com"]),
      response,
    );
    assert.deepEqual(call.mock.calls[0].arguments, [
      ["https://example.com"],
      { highlights: true },
    ]);
  } finally {
    call.mock.restore();
    if (original === undefined) {
      delete process.env.EXA_API_KEY;
    } else {
      process.env.EXA_API_KEY = original;
    }
  }
});

test("reject invalid requests before contacting Exa", async () => {
  await assert.rejects(searchWeb("  "));
  await assert.rejects(searchWeb("topic", 11));
  await assert.rejects(searchWeb("topic", 1.5));
  await assert.rejects(extractWeb([]));
  await assert.rejects(extractWeb(["file:///etc/hosts"]));
  await assert.rejects(extractWeb(["https://user:secret@example.com"]));
});

test("missing credentials fail clearly without network access", async () => {
  const original = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  try {
    await assert.rejects(searchWeb("topic"), /Web search is not configured/);
  } finally {
    if (original !== undefined) {
      process.env.EXA_API_KEY = original;
    }
  }
});
