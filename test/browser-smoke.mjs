import assert from "node:assert/strict";
import { chromium } from "../../The Common Crown/node_modules/playwright-core/index.mjs";
import {
  beginVisit,
  createGame,
  fallbackDeparturePlan,
  finishVisit
} from "../js/simulation.js";
import { sealState, serializeState } from "../js/state.js";

function asLegacySave(state) {
  const legacy = JSON.parse(JSON.stringify(state));
  legacy.version = 1;
  for (const field of [
    "schemaVersion", "priest", "households", "externalActors", "eventQueue",
    "commandLog", "aiProposals", "events", "nextEventSequence",
    "nextCommandSequence", "replayBase", "integrityHash"
  ]) {
    delete legacy[field];
  }

  return legacy;
}

function checkpointState(state) {
  const snapshot = JSON.parse(JSON.stringify({
    ...state,
    commandLog: [],
    aiProposals: [],
    nextCommandSequence: 1,
    replayBase: null
  }));
  sealState(snapshot);
  state.commandLog = [];
  state.aiProposals = [];
  state.nextCommandSequence = 1;
  state.replayBase = {
    kind: "periodic",
    checkpointDay: state.calendar.absoluteDay,
    checkpointSlot: state.calendar.slot,
    snapshot
  };
  sealState(state);
  return state;
}

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
  if (schemaName === "parish_opening") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              opening: "Father, I have rehearsed this twice outside and it sounded easier there. Someone may suffer for a choice I made. Tell me plainly: should I confess now, even if my household pays for it?"
            })
          }
        }]
      })
    });
    return;
  }
  if (schemaName === "parish_conversation") {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (payload.messages?.some((message) => message.content?.includes("FAIL_STALE"))) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [] }) });
      return;
    }
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
  if (schemaName === "departure_cascade") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [] })
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
  const staleImport = createGame("browser-smoke-parish");
  beginVisit(staleImport);
  staleImport.currentVisit.location = "nave";
  staleImport.currentVisit.issue.location = "nave";
  staleImport.currentVisit.intent.disclosureThreshold = 0;
  checkpointState(staleImport);
  await page.locator("#counsel-input").fill("Take time before you act.");
  await page.locator("#speak-button").click();
  assert.equal(await page.locator("#next-hour").isDisabled(), true);
  await page.locator("#import-file").setInputFiles({
    name: "invalid-import.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken")
  });
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.startsWith("Import failed:"));
  assert.equal(await page.locator("#speak-button").isDisabled(), true);
  assert.equal(await page.locator("#next-hour").isDisabled(), true);
  await page.locator("#dialogue-log .visitor").nth(1).waitFor({ state: "visible" });
  assert.equal(await page.locator("#speak-button").isDisabled(), false);
  assert.match(await page.locator("#turn-counter").innerText(), /1 \/ 10/);
  await page.locator("#import-file").setInputFiles({
    name: "stale-guard.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeState(staleImport))
  });
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "Imported parish loaded.");
  assert.match(await page.locator("#turn-counter").innerText(), /0 \/ 10/);
  await page.locator("#counsel-input").fill("Take time before you act.");
  await page.locator("#speak-button").click();
  await page.locator("#dialogue-log .visitor").nth(1).waitFor({ state: "visible" });
  await page.locator("#dialogue-log .visitor").nth(2).waitFor({ state: "visible" });
  assert.match(await page.locator("#dialogue-log .visitor").nth(2).innerText(), /There is more:/);
  assert.equal(await page.locator("#next-hour").isDisabled(), false);
  assert.match(await page.locator("#turn-counter").innerText(), /1 \/ 10/);
  await page.locator("#counsel-input").fill("Let us go talk in private in your office.");
  await page.locator("#speak-button").click();
  await page.locator("#dialogue-log .visitor").nth(3).waitFor({ state: "visible" });
  assert.equal((await page.locator("#location-name").textContent()).trim(), "The Parish Office");
  assert.match(await page.locator("#turn-counter").innerText(), /2 \/ 10/);
  await page.locator("#next-hour").click();
  await page.locator("#turn-counter").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#turn-counter")?.textContent?.startsWith("0 / 10"));
  await page.waitForFunction(() => new Promise((resolve) => {
    const request = indexedDB.open("the-common-confessor", 1);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("autosaves", "readonly");
      const slot = transaction.objectStore("autosaves").get("slot-1");
      slot.onsuccess = () => {
        database.close();
        resolve(Boolean(slot.result));
      };
      slot.onerror = () => resolve(false);
    };
    request.onerror = () => resolve(false);
  }));
  const saveMetadata = await page.evaluate(() => ({
    manualEnvelope: JSON.parse(localStorage.getItem("the-common-confessor-save-v2")),
    legacyAutosaves: [
      localStorage.getItem("the-common-confessor-autosave-0"),
      localStorage.getItem("the-common-confessor-autosave-1"),
      localStorage.getItem("the-common-confessor-autosave-2")
    ]
  }));
  const manualState = JSON.parse(saveMetadata.manualEnvelope.data);
  assert.equal(saveMetadata.manualEnvelope.format, "the-common-confessor-save");
  assert.equal(manualState.schemaVersion, 13);
  assert.equal(await page.locator("#open-request-visits").isDisabled(), true);
  assert.match(await page.locator("#church-resources").innerText(), /Bread/i);
  assert.equal(manualState.commandLog.length, 1);
  assert.equal(manualState.commandLog[0].type, "begin_visit");
  assert.equal(manualState.commandLog[0].source, "ai");
  assert.match(manualState.commandLog[0].payload.opening, /^Father,/);
  assert.equal(manualState.replayBase.kind, "periodic");
  assert.deepEqual(saveMetadata.legacyAutosaves, [null, null, null]);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-game").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.json$/);
  const originalTown = await page.locator("#town-name").innerText();
  const staleLegacy = asLegacySave(createGame("stale-legacy-parish"));
  const olderPrimary = {
    format: "the-common-confessor-save",
    savedAt: 1,
    data: serializeState(createGame("older-primary-parish"))
  };
  await page.evaluate(({ legacy, older }) => {
    localStorage.setItem("the-common-confessor-save-v1", JSON.stringify(legacy));
    localStorage.setItem("the-common-confessor-save-v2", JSON.stringify(older));
  }, { legacy: staleLegacy, older: olderPrimary });
  await page.reload({ waitUntil: "networkidle" });
  const continueClick = page.locator("#continue-game").click();
  await page.waitForFunction(() => document.querySelector("#new-game")?.disabled === true);
  await continueClick;
  await page.locator("#visitor-panel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#town-name").innerText(), originalTown);
  assert.equal(await page.evaluate(() => localStorage.getItem("the-common-confessor-save-v1")), null);
  await page.evaluate(() => localStorage.setItem("the-common-confessor-save-v2", "{broken"));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#continue-game").click();
  await page.locator("#visitor-panel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#town-name").innerText(), originalTown);

  const canvasSize = await page.locator("#church-canvas").evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height
  }));
  assert.ok(canvasSize.width > 1000 && canvasSize.height > 700);
  await page.waitForTimeout(2800);
  await page.screenshot({ path: "test/browser-smoke.png", fullPage: true });

  const idleImportState = createGame("idle-import-lock-parish");
  beginVisit(idleImportState);
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    File.prototype.text = function delayedText() {
      return new Promise((resolve, reject) => {
        setTimeout(() => originalText.call(this).then(resolve, reject), 500);
      });
    };
  });
  const idleImport = page.locator("#import-file").setInputFiles({
    name: "idle-import-lock.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeState(idleImportState))
  });
  await page.waitForFunction(() => (
    document.querySelector("#speak-button")?.disabled === true
    && document.querySelector("#next-hour")?.disabled === true
  ));
  await idleImport;
  await page.waitForFunction((name) => document.querySelector("#town-name")?.textContent === name, idleImportState.town.name);
  assert.match(await page.locator("#turn-counter").innerText(), /0 \/ 10/);

  const sundayState = createGame("browser-sunday-parish");
  while (sundayState.calendar.dayIndex !== 6) {
    beginVisit(sundayState);
    finishVisit(sundayState, { ...fallbackDeparturePlan(sundayState), source: "fallback" });
  }
  await page.locator("#counsel-input").fill("FAIL_STALE");
  await page.locator("#speak-button").click();
  await page.locator("#import-file").setInputFiles({
    name: "sunday-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeState(sundayState))
  });
  await page.locator("#sermon-panel").waitFor({ state: "visible" });
  await page.waitForTimeout(500);
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

  const importedState = createGame("browser-import-parish");
  const importedTown = importedState.town.name;
  await page.locator("#import-file").setInputFiles({
    name: "imported-parish.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeState(importedState))
  });
  await page.waitForFunction((name) => document.querySelector("#town-name")?.textContent === name, importedTown);
  const quotaProbe = await page.evaluate(async () => {
    const storage = await import("/js/storage.js");
    await new Promise((resolve) => {
      const request = indexedDB.open("the-common-confessor", 1);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("autosaves", "readwrite");
        transaction.objectStore("autosaves").clear();
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          resolve();
        };
      };
      request.onerror = resolve;
    });
    const snapshots = ["a", "b", "c", "d"].map((letter) => letter.repeat(1_500_000));
    localStorage.setItem("quota-probe-primary", snapshots[0]);
    await storage.queueAutosave(snapshots[0]);
    await storage.queueAutosave(snapshots[1]);
    await storage.queueAutosave(snapshots[2]);
    const beforeEviction = (await storage.readAutosaves()).map((value) => value[0]);
    await storage.queueAutosave(snapshots[3]);
    const afterEviction = (await storage.readAutosaves()).map((value) => value[0]);
    localStorage.removeItem("quota-probe-primary");
    return { beforeEviction, afterEviction };
  });
  assert.deepEqual(quotaProbe.beforeEviction, ["c", "b", "a"]);
  assert.deepEqual(quotaProbe.afterEviction, ["d", "c", "b"]);
  await page.evaluate(() => new Promise((resolve) => {
    localStorage.clear();
    const request = indexedDB.deleteDatabase("the-common-confessor");
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  }));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#start-import-game").waitFor({ state: "visible" });
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    File.prototype.text = function delayedText() {
      return new Promise((resolve, reject) => {
        setTimeout(() => originalText.call(this).then(resolve, reject), 500);
      });
    };
  });
  const coldImport = page.locator("#import-file").setInputFiles({
    name: "cold-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeState(importedState))
  });
  await page.waitForFunction(() => document.querySelector("#new-game")?.disabled === true);
  await coldImport;
  await page.waitForFunction((name) => document.querySelector("#town-name")?.textContent === name, importedTown);
  const largeLegacyState = createGame("large-legacy-parish");
  largeLegacyState.residents.forEach((person, index) => {
    person.memories.push(`${index}:` + "m".repeat(7600));
  });
  const largeLegacy = asLegacySave(largeLegacyState);
  await page.evaluate((legacy) => new Promise((resolve) => {
    localStorage.clear();
    const request = indexedDB.deleteDatabase("the-common-confessor");
    request.onsuccess = request.onerror = request.onblocked = () => {
      localStorage.setItem("the-common-confessor-save-v1", JSON.stringify(legacy));
      resolve();
    };
  }), largeLegacy);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#continue-game").waitFor({ state: "visible" });
  await page.locator("#continue-game").click();
  await page.waitForFunction((name) => document.querySelector("#town-name")?.textContent === name, largeLegacyState.town.name);

  const blockedPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await blockedPage.addInitScript(() => {
    const denied = () => {
      throw new DOMException("Storage access denied", "SecurityError");
    };
    Storage.prototype.getItem = denied;
    Storage.prototype.setItem = denied;
    Storage.prototype.removeItem = denied;
  });
  await blockedPage.route("**/local-ai/health", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
  });
  await blockedPage.goto("http://127.0.0.1:8086", { waitUntil: "networkidle" });
  await blockedPage.locator("#new-game").waitFor({ state: "visible" });
  assert.equal(await blockedPage.locator("#new-game").isDisabled(), false);
  assert.equal(await blockedPage.locator("#start-import-game").isDisabled(), false);
  await blockedPage.close();

  const failurePage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await failurePage.route("**/local-ai/health", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
  });
  await failurePage.goto("http://127.0.0.1:8086", { waitUntil: "networkidle" });
  const retainedLegacy = asLegacySave(createGame("retained-legacy-parish"));
  await failurePage.evaluate((legacy) => new Promise((resolve) => {
    localStorage.clear();
    localStorage.setItem("the-common-confessor-save-v1", JSON.stringify(legacy));
    const request = indexedDB.deleteDatabase("the-common-confessor");
    request.onsuccess = request.onerror = request.onblocked = resolve;
  }), retainedLegacy);
  await failurePage.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function guardedSet(key, value) {
      if (key === "the-common-confessor-save-v2") {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return originalSet.call(this, key, value);
    };
    IDBFactory.prototype.open = function deniedOpen() {
      throw new DOMException("IndexedDB denied", "SecurityError");
    };
  });
  await failurePage.reload({ waitUntil: "networkidle" });
  await failurePage.locator("#continue-game").waitFor({ state: "visible" });
  await failurePage.locator("#continue-game").click();
  await failurePage.locator("#visitor-panel").waitFor({ state: "visible" });
  assert.ok(await failurePage.evaluate(() => localStorage.getItem("the-common-confessor-save-v1")));
  await failurePage.close();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
