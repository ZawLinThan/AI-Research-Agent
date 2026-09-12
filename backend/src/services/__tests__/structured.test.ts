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

test("search review corrects a missing reason once without accepting incomplete output", async (t) => {
  const { reviewSearch } = await import("../search.service.js");
  const { withProviderCalls } = await import("../../lib/providerCalls.js");
  let attempts = 0,
    additionalCalls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    attempts++;
    assert.match(request.messages[0].content, /including reason/);
    assert.match(
      request.messages[0].content,
      /Required top-level fields:.*reason/,
    );
    if (attempts === 1)
      throw Object.assign(new Error("missing properties: reason"), {
        status: 400,
        code: "json_validate_failed",
      });
    assert.match(request.messages[0].content, /previous attempt was invalid/);
    return {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              sufficient: true,
              relevanceScore: 0.8,
              coverageScore: 0.8,
              sourceQualityScore: 0.8,
              missingEvidence: [],
              weakAreas: [],
              followUpQueries: [],
              reason: "The excerpts cover the question.",
            }),
          },
        },
      ],
    };
  });
  const review = await withProviderCalls(
    async () => {
      additionalCalls++;
    },
    () =>
      reviewSearch(
        "How do queues work?",
        { queries: ["queue research"] },
        {},
        new AbortController().signal,
      ),
  );
  assert.equal(review.reason, "The excerpts cover the question.");
  assert.equal(attempts, 2);
  assert.equal(additionalCalls, 1);
});

test("malformed JSON is corrected locally but rate limits are left for the queue", async (t) => {
  let attempts = 0;
  const schema = z.object({ reason: z.string() });
  const call = t.mock.method(client.chat.completions, "create", async () => {
    attempts++;
    return {
      choices: [
        {
          message: {
            content: attempts === 1 ? "{}" : '{"reason":"Supported"}',
          },
        },
      ],
    };
  });
  assert.deepEqual(await structured("Review", {}, schema), {
    reason: "Supported",
  });
  assert.equal(attempts, 2);
  call.mock.restore();
  attempts = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    attempts++;
    throw Object.assign(new Error("rate limit"), { status: 429 });
  });
  await assert.rejects(structured("Review", {}, schema), /rate limit/);
  assert.equal(attempts, 1);
});

test("search-review input and output stay bounded as results accumulate", async () => {
  const { prepareSearchReview } = await import("../search.service.js");
  const { searchReviewSchema } =
    await import("../../zodSchema/search.schema.js");
  const searches = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      `query-${i}`,
      Array.from({ length: 10 }, () => ({
        id: "source",
        title: "x".repeat(10000),
        url: "https://example.com/" + "a".repeat(10000),
        highlights: ["e".repeat(10000), "f".repeat(10000)],
        queries: [],
        retrievedAt: "now",
      })),
    ]),
  );
  const summary = prepareSearchReview(searches);
  assert.ok(JSON.stringify(summary).length <= 10002);
  assert.equal(summary.length, 10);
  assert.equal(summary.at(-1)?.query, "query-99");
  assert.ok(summary.every((q) => q.topResults.length > 0));
  assert.ok(summary.every((q) => q.topResults.length <= 2));
  assert.equal(
    searchReviewSchema.safeParse({ sufficient: true }).success,
    false,
  );
});
