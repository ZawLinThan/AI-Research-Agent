import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { client, structured } from "../../config/groqAI.js";
import { publicError } from "../../lib/errors.js";

test("structured requests use object instructions and validate the response", async (t) => {
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    assert.equal(request.response_format.type, "json_schema");
    assert.equal(request.response_format.json_schema.strict, true);
    assert.deepEqual(request.response_format.json_schema.schema.required, [
      "queries",
    ]);
    assert.match(request.messages[0].content, /only a JSON object/);
    assert.doesNotMatch(request.messages[0].content, /raw JSON array/);
    return {
      choices: [{ message: { content: '{"queries":["retry jobs"]}' } }],
    };
  });
  assert.deepEqual(
    await structured(
      'Return {"queries":[]}',
      {},
      z.object({ queries: z.array(z.string()) }),
    ),
    { queries: ["retry jobs"] },
  );
});

test("invalid provider JSON is distinguished from an outage", () => {
  assert.match(
    publicError({ code: "json_validate_failed", status: 400 }),
    /valid research data/,
  );
  assert.match(publicError({ status: 503 }), /provider is unavailable/);
});

test("truncated or invalid model output is retryable without accepting bad data", async (t) => {
  const { retryable, ModelOutputError } = await import("../../lib/errors.js");
  let response: any = {
    choices: [
      { finish_reason: "length", message: { content: '{"queries":[]}' } },
    ],
  };
  t.mock.method(client.chat.completions, "create", async () => response);
  const call = () =>
    structured(
      "Return queries",
      {},
      z.object({ queries: z.array(z.string()) }),
    );
  await assert.rejects(call, ModelOutputError);
  response = {
    choices: [
      { finish_reason: "stop", message: { content: '{"queries":false}' } },
    ],
  };
  await assert.rejects(call, ModelOutputError);
  assert.equal(retryable(new ModelOutputError()), true);
  assert.equal(retryable({ status: 400, code: "json_validate_failed" }), true);
  assert.equal(retryable({ status: 400, code: "invalid_api_key" }), false);
});

test("analysis copies selected source excerpts exactly instead of generating quotes", async (t) => {
  const { analyzeEvidence } = await import("../evidence.service.js");
  const text = "Workers retry failed jobs with the configured backoff delay.";
  const sources = [
    {
      id: "S123",
      url: "https://example.com",
      title: "Queue documentation",
      highlights: [text],
      queries: ["retries"],
      retrievedAt: new Date().toISOString(),
    },
  ];
  let ids = ["S123:0"];
  t.mock.method(client.chat.completions, "create", async () => ({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            findings: [
              { claim: "Failed jobs can be retried.", excerptIds: ids },
            ],
            gaps: [],
            followUpQueries: [],
          }),
        },
      },
    ],
  }));
  const result = await analyzeEvidence("How do retries work?", sources);
  assert.deepEqual(result.findings[0].evidence, [
    { sourceId: "S123", quote: text },
  ]);
  ids = ["invented:0"];
  await assert.rejects(() => analyzeEvidence("How do retries work?", sources));
});
