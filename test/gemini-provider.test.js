import test from "node:test";
import assert from "node:assert/strict";
import { ParishAiClient, GEMINI_MODEL } from "../js/ai.js";
import { createGame } from "../js/simulation.js";
import { serializeState } from "../js/state.js";

const SECRET = "AIza-this-is-not-a-real-key-000";

function stubGemini(reply, { ok = true, status = 200, body = "" } = {}) {
  const calls = [];
  const client = new ParishAiClient({
    provider: "gemini",
    apiKey: SECRET,
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (!ok) return { ok: false, status, text: async () => body };
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] })
      };
    }
  });
  return { client, calls };
}

const SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["reply"],
  properties: {
    reply: { type: "string", description: "what is said aloud" },
    tally: { type: ["integer", "null"] },
    gifts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["resource"],
        properties: { resource: { type: "string" }, amount: { type: "integer" } }
      }
    }
  }
});

test("the parish can speak through Gemini instead of a local model", async () => {
  const { client, calls } = stubGemini({ reply: "Peace be with you, Father." });
  const result = await client.complete("Say something.", SCHEMA, "test", 400);
  assert.deepEqual(result, { reply: "Peace be with you, Father." });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes(GEMINI_MODEL), "the free-tier flash model should be used");
  assert.ok(calls[0].url.includes(encodeURIComponent(SECRET)), "the player's own key should authenticate the call");
});

test("schemas are translated into the subset Gemini accepts", async () => {
  const { client, calls } = stubGemini({ reply: "Aye." });
  await client.complete("Say something.", SCHEMA, "test", 400);
  const sent = calls[0].body.generationConfig.responseSchema;

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    assert.ok(!("additionalProperties" in node), "Gemini rejects additionalProperties");
    assert.ok(!Array.isArray(node.type), "a union type must become a nullable type");
    if (node.properties) Object.values(node.properties).forEach(walk);
    if (node.items) walk(node.items);
  };
  walk(sent);

  assert.equal(sent.properties.tally.type, "integer");
  assert.equal(sent.properties.tally.nullable, true);
  assert.deepEqual(sent.required, ["reply"]);
  assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
});

test("Gemini is asked for an answer rather than deliberation", async () => {
  const { client, calls } = stubGemini({ reply: "Aye." });
  await client.complete("Say something.", SCHEMA, "test", 400);
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingBudget, 0,
    "thinking tokens would eat the budget before anything is written");
  assert.ok(calls[0].body.generationConfig.maxOutputTokens >= 256);
});

test("a missing key is refused before anything is sent", async () => {
  const client = new ParishAiClient({
    provider: "gemini",
    apiKey: "",
    fetchImpl: async () => assert.fail("nothing should be sent without a key")
  });
  await assert.rejects(() => client.complete("Say something.", SCHEMA, "test", 400), /API key/);
  await assert.rejects(() => client.health(), /API key/);
});

test("a rejected key and a rate limit are reported in plain words", async () => {
  const rejected = stubGemini(null, { ok: false, status: 403, body: "API key not valid" });
  await assert.rejects(() => rejected.client.complete("x", SCHEMA, "t", 400), /Gemini rejected/);

  const limited = stubGemini(null, { ok: false, status: 429, body: "quota" });
  await assert.rejects(() => limited.client.complete("x", SCHEMA, "t", 400), /rate limited/);
});

test("an empty answer names the reason rather than failing blankly", async () => {
  const client = new ParishAiClient({
    provider: "gemini",
    apiKey: SECRET,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] })
    })
  });
  await assert.rejects(() => client.complete("x", SCHEMA, "t", 400), /SAFETY/);
});

test("the local provider is untouched by any of this", async () => {
  const calls = [];
  const client = new ParishAiClient({
    endpoint: "/local-ai",
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: "Aye." }) } }] })
      };
    }
  });
  const result = await client.complete("Say something.", SCHEMA, "test", 400);
  assert.deepEqual(result, { reply: "Aye." });
  assert.ok(calls[0].endsWith("/local-ai/v1/chat/completions"));
  assert.ok(!calls[0].includes("googleapis"), "the local path must not reach out to Google");
});

test("the key never travels with a saved parish", () => {
  const state = createGame("gemini-save");
  state.settings.aiProvider = "gemini";
  const saved = serializeState(state);
  assert.ok(!saved.includes(SECRET), "an API key must never be written into a save");
  assert.ok(!/apiKey|geminiKey|api_key/i.test(saved), "a save should carry no key field at all");
});

test("choosing Gemini is a valid setting a save can carry", () => {
  const state = createGame("gemini-setting");
  state.settings.aiProvider = "gemini";
  assert.doesNotThrow(() => serializeState(state));
});
