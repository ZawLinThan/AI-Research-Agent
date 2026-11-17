import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { client, structured } from "../../config/openRouterAI.js";
import { ModelOutputError, publicError } from "../../lib/errors.js";

function promptSchema(request: any) {
  const match = request.messages[0].content.match(
    /JSON Schema: (.+)\. Return raw JSON/,
  );
  assert.ok(match, "The model must receive the complete output schema");
  return JSON.parse(match[1]);
}

test("truncation recovery fits the configured token window", async (t) => {
  const { openRouterTokensPerMinute: limit } =
    await import("../../config/researchLimits.js");
  const { configureProviderScheduler, ProviderScheduler } =
    await import("../../lib/providerRateLimit.js");
  const reservations: number[] = [];
  configureProviderScheduler(
    "openrouter",
    new ProviderScheduler({
      acquire: async (tokens) => {
        assert.ok(tokens <= limit);
        reservations.push(tokens);
        return 0;
      },
      cooldown: async () => {},
    }),
  );
  t.after(() => configureProviderScheduler("openrouter"));
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    assert.ok(request.max_tokens > 0);
    assert.ok(
      Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 3) +
        request.max_tokens <=
        limit,
    );
    if (++calls === 1) {
      return {
        choices: [{ finish_reason: "length", message: { content: "{" } }],
      };
    }

    return {
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
    };
  });
  assert.deepEqual(
    await structured(
      "Analyze",
      { text: "x".repeat(6000) },
      z.object({ ok: z.boolean() }),
      undefined,
      4000,
    ),
    { ok: true },
  );
  assert.equal(calls, 2);
  assert.equal(reservations[1], limit);
});

test("structured requests use object instructions and validate the response", async (t) => {
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    assert.equal(client.baseURL, "https://openrouter.ai/api/v1");
    assert.equal(
      request.model,
      process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning",
    );
    assert.equal(request.max_tokens, 2500);
    assert.equal(request.max_completion_tokens, undefined);
    assert.equal(request.reasoning_effort, undefined);
    assert.equal(request.response_format, undefined);
    assert.deepEqual(promptSchema(request).required, ["queries"]);
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
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    assert.deepEqual(promptSchema(request).required, ["findings", "gaps"]);
    assert.equal(promptSchema(request).properties.followUpQueries, undefined);
    assert.doesNotMatch(request.messages[0].content, /"followUpQueries"/);
    return {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              findings: [
                { claim: "Failed jobs can be retried.", excerptIds: ids },
              ],
              gaps: [],
            }),
          },
        },
      ],
    };
  });
  const result = await analyzeEvidence("How do retries work?", sources);
  assert.deepEqual(result.followUpQueries, []);
  assert.deepEqual(result.findings[0].evidence, [
    { sourceId: "S123", quote: text },
  ]);
  ids = ["invented:0"];
  const unsupported = await analyzeEvidence("How do retries work?", sources);
  assert.deepEqual(unsupported.findings, []);
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
    if (attempts === 1) {
      throw Object.assign(new Error("missing properties: reason"), {
        status: 400,
        code: "json_validate_failed",
      });
    }
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

test("worker scheduling retries OpenRouter 429 in place and counts each actual request", async (t) => {
  const { ProviderScheduler, configureProviderScheduler } =
    await import("../../lib/providerRateLimit.js");
  const { withProviderCalls } = await import("../../lib/providerCalls.js");
  const waits: number[] = [];
  configureProviderScheduler(
    "openrouter",
    new ProviderScheduler(
      { acquire: async () => 0, cooldown: async () => {} },
      async (n) => {
        waits.push(n);
      },
    ),
  );
  t.after(() => configureProviderScheduler("openrouter"));
  let requests = 0,
    extraCalls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    if (++requests === 1) {
      throw Object.assign(new Error("rate limit"), {
        status: 429,
        headers: new Headers({ "retry-after": "2" }),
      });
    }
    return {
      choices: [{ message: { content: '{"reason":"Enough evidence"}' } }],
    };
  });
  const result = await withProviderCalls(
    async () => {
      extraCalls++;
    },
    () => structured("Review", {}, z.object({ reason: z.string() })),
  );
  assert.equal(result.reason, "Enough evidence");
  assert.equal(requests, 2);
  assert.equal(extraCalls, 1);
  assert.deepEqual(waits, [3000]);
});

test("exhausted corrections preserve missing-field diagnostics and provider identity", async (t) => {
  const { ModelOutputError, modelValidationDetails, publicError } =
    await import("../../lib/errors.js");
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    if (calls === 2) {
      assert.match(request.messages[0].content, /reason.*invalid_type/);
    }

    return { choices: [{ finish_reason: "stop", message: { content: "{}" } }] };
  });
  await assert.rejects(
    structured("Review", {}, z.object({ reason: z.string() })),
    (error: unknown) => {
      assert.ok(error instanceof ModelOutputError);
      assert.equal(error.name, "ModelOutputError");
      assert.equal(error.provider, "openrouter");
      assert.equal(error.code, "json_validate_failed");
      assert.deepEqual(modelValidationDetails(error), {
        kind: "schema_validation",
        issues: [{ path: "reason", code: "invalid_type" }],
        correctionAttempted: true,
      });
      assert.match(publicError(error), /valid research data/);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("provider-side schema rejection retains status and safe field diagnostics", async (t) => {
  const { ModelOutputError, modelValidationDetails } =
    await import("../../lib/errors.js");
  t.mock.method(client.chat.completions, "create", async () => {
    throw Object.assign(new Error("Generated JSON failed validation"), {
      status: 400,
      code: "json_validate_failed",
      error: {
        failed_generation: JSON.stringify({
          score: 2,
          privateText: "sensitive provider text",
        }),
      },
    });
  });
  await assert.rejects(
    structured(
      "Review",
      {},
      z.object({ score: z.number().max(1), reason: z.string() }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ModelOutputError);
      assert.equal(error.status, 400);
      assert.deepEqual(error.issues, [
        { path: "score", code: "too_big" },
        { path: "reason", code: "invalid_type" },
      ]);
      assert.doesNotMatch(
        JSON.stringify(modelValidationDetails(error)),
        /sensitive provider text|privateText/,
      );
      return true;
    },
  );
});

test("truncation and invalid JSON remain distinguishable after corrections", async (t) => {
  const { ModelOutputError } = await import("../../lib/errors.js");
  let reason = "length";
  t.mock.method(client.chat.completions, "create", async () => ({
    choices: [{ finish_reason: reason, message: { content: "not JSON" } }],
  }));
  const call = () => structured("Review", {}, z.object({ reason: z.string() }));
  await assert.rejects(
    call(),
    (error: unknown) =>
      error instanceof ModelOutputError &&
      error.kind === "truncated" &&
      error.correctionAttempted,
  );
  reason = "stop";
  await assert.rejects(
    call(),
    (error: unknown) =>
      error instanceof ModelOutputError &&
      error.kind === "invalid_json" &&
      error.correctionAttempted,
  );
});

test("provider missing-property text is restricted to known schema fields", async (t) => {
  const { ModelOutputError } = await import("../../lib/errors.js");
  t.mock.method(client.chat.completions, "create", async () => {
    throw Object.assign(
      new Error("missing properties: 'reason', 'private-value'"),
      { status: 400, code: "json_validate_failed" },
    );
  });
  await assert.rejects(
    structured("Review", {}, z.object({ reason: z.string() })),
    (error: unknown) => {
      assert.ok(error instanceof ModelOutputError);
      assert.equal(error.kind, "provider_schema_validation");
      assert.deepEqual(error.issues, [
        { path: "reason", code: "missing_property" },
      ]);
      return true;
    },
  );
});

test("analysis without excerpts keeps the legacy empty-query field without a model call", async (t) => {
  const { analyzeEvidence } = await import("../evidence.service.js");
  t.mock.method(client.chat.completions, "create", async () =>
    assert.fail("No model call should be made without evidence"),
  );
  const result = await analyzeEvidence("Question", []);
  assert.deepEqual(result.followUpQueries, []);
  assert.deepEqual(result.findings, []);
});

test("truncation retries with more output tokens and reserves the larger budget", async (t) => {
  const { configureProviderScheduler, ProviderScheduler } =
    await import("../../lib/providerRateLimit.js");
  const reservations: number[] = [];
  configureProviderScheduler(
    "openrouter",
    new ProviderScheduler({
      acquire: async (tokens) => {
        reservations.push(tokens);
        return 0;
      },
      cooldown: async () => {},
    }),
  );
  t.after(() => configureProviderScheduler("openrouter"));
  const previousModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning";
  t.after(() => {
    if (previousModel === undefined) {
      delete process.env.OPENROUTER_MODEL;
    } else {
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    assert.deepEqual(request.reasoning, { enabled: false });
    assert.equal(request.max_tokens, 1400 * 2 ** (calls - 1));
    if (calls > 1) {
      assert.match(request.messages[0].content, /compact JSON/);
    }

    if (calls < 3) {
      return {
        choices: [
          { finish_reason: "length", message: { content: '{"queries":[' } },
        ],
      };
    }
    return {
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"queries":["queue retries"]}' },
        },
      ],
    };
  });
  assert.deepEqual(
    await structured(
      "Plan",
      {},
      z.object({ queries: z.array(z.string()) }),
      undefined,
      1400,
    ),
    { queries: ["queue retries"] },
  );
  assert.equal(calls, 3);
  assert.ok(reservations[1]! >= reservations[0]! + 1400);
  assert.ok(reservations[2]! >= reservations[1]! + 2800);
});

test("persistent truncation stops after three calls without accepting partial JSON", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return {
      choices: [
        {
          finish_reason: "length",
          message: { content: '{"reason":"partial"}' },
        },
      ],
    };
  });
  await assert.rejects(
    structured("Review", {}, z.object({ reason: z.string() })),
    (error: unknown) =>
      error instanceof ModelOutputError &&
      error.kind === "truncated" &&
      error.correctionAttempted,
  );
  assert.equal(calls, 3);
});
