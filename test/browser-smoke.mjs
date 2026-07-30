import assert from "node:assert/strict";
import { chromium } from "../../The Common Crown/node_modules/playwright-core/index.mjs";
import { createGame } from "../js/simulation.js";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
await page.route("**/local-ai/health", async (route) => {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
});
await page.route("**/local-ai/v1/chat/completions", async (route) => {
  const payload = JSON.parse(route.request().postData() || "{}");
  const schemaName = payload.response_format?.json_schema?.name;
  if (schemaName === "parish_conversation") {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              reply: "I will consider that carefully, Father.",
              mood: "contemplative",
              trustDelta: 1,
              stressDelta: -1,
              memory: "The priest asked for patience."
            })
          }
        }]
      })
    });
    return;
  }
  if (schemaName === "sunday_sermon") {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "The king arrived and burned the mill.",
              townDeltas: { harmony: 1, faith: 2, prosperity: 0, health: 0, safety: 0, mercy: 2 },
              responseTags: ["mercy"],
              notableEffects: []
            })
          }
        }]
      })
    });
    return;
  }
  await route.abort();
});
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.stack || error.message));

try {
  await page.goto("http://127.0.0.1:8086", { waitUntil: "networkidle" });
  await page.locator("#seed-input").fill("browser-smoke-parish");
  await page.locator("#new-game").click();
  await page.locator("#prologue-dialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#prologue-dialog").innerText(), /200 names/);
  await page.locator("#begin-monday").click();
  await page.locator("#visitor-panel").waitFor({ state: "visible" });
  const location = (await page.locator("#location-name").textContent()).trim();
  assert.ok(["The Confessional", "The Parish Office", "The Main Nave", "Before the Shrine"].includes(location));
  assert.match(await page.locator("#turn-counter").innerText(), /0 \/ 10/);
  assert.equal(await page.locator("#population-count").innerText(), "200");
  await page.locator("#counsel-input").fill("Take time before you act.");
  await page.locator("#speak-button").click();
  assert.equal(await page.locator("#next-hour").isDisabled(), true);
  await page.locator("#dialogue-log .visitor").nth(1).waitFor({ state: "visible" });
  assert.equal(await page.locator("#next-hour").isDisabled(), false);
  assert.match(await page.locator("#turn-counter").innerText(), /1 \/ 10/);
  const canvasSize = await page.locator("#church-canvas").evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height
  }));
  assert.ok(canvasSize.width > 1000 && canvasSize.height > 700);
  await page.waitForTimeout(2800);
  await page.screenshot({ path: "test/browser-smoke.png", fullPage: true });

  const sundayState = createGame("browser-sunday-parish");
  sundayState.calendar.absoluteDay = 6;
  sundayState.calendar.dayIndex = 6;
  sundayState.calendar.week = 1;
  sundayState.settings.aiEnabled = true;
  await page.evaluate((savedState) => {
    localStorage.setItem("the-common-confessor-save-v1", JSON.stringify(savedState));
  }, sundayState);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#continue-game").click();
  await page.locator("#sermon-panel").waitFor({ state: "visible" });
  assert.match(await page.locator("#attendance-count").innerText(), /\d+ of 200/);
  await page.locator("#sermon-text").fill(Array(101).fill("mercy").join(" "));
  await page.locator("#deliver-sermon").click();
  await page.locator("#toast").waitFor({ state: "visible" });
  assert.match(await page.locator("#toast").innerText(), /1 to 100 words/);
  await page.locator("#sermon-text").fill("Let mercy guide correction, restore neighbors, and keep every door open to repentance.");
  await page.locator("#deliver-sermon").click();
  assert.equal(await page.locator("#deliver-sermon").isDisabled(), true);
  await page.locator("#visitor-panel").waitFor({ state: "visible" });
  assert.match(await page.locator("#calendar-label").innerText(), /Monday, Week 2/);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
