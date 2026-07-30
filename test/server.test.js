import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { createStaticServer } from "../scripts/server.mjs";

test("server serves the game and rejects foreign-origin AI requests", async () => {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  try {
    const game = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(game.status, 200);
    assert.match(await game.text(), /<title>The Common Confessor<\/title>/);
    const forbidden = await fetch(`http://127.0.0.1:${port}/local-ai/health`, {
      headers: { Origin: "https://malicious.example" }
    });
    assert.equal(forbidden.status, 403);
    const rebound = await fetch(`http://127.0.0.1:${port}/local-ai/health`, {
      headers: { Host: "attacker.example", Origin: "http://attacker.example" }
    });
    assert.equal(rebound.status, 403);
    const malformedStatus = await new Promise((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/%E0%A4%A"
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(malformedStatus, 400);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
