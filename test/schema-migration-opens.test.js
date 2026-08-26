/* Every version we ever shipped has to still open.
   The integrity check kept a hand-written list of the schema versions a save
   was allowed to have been migrated from, and the list was not extended when
   the schema went to 19 or to 20. The failure was silent and complete: the
   save failed integrity, the loader caught the throw, and the player was
   handed a fresh parish with their own quietly discarded. Two releases went
   out that way. This walks every version instead of naming any, so it cannot
   fall behind the schema again. */

import test from "node:test";
import assert from "node:assert/strict";

import { createGame } from "../js/simulation.js";
import {
  STATE_SCHEMA_VERSION,
  serializeState,
  deserializeState,
  sealState
} from "../js/state.js";

/** A save as an older build would have written it. */
function saveFromVersion(version) {
  const state = createGame(`migrate-from-${version}`);
  const raw = JSON.parse(serializeState(state));
  raw.schemaVersion = version;
  raw.version = version;
  sealState(raw);
  return JSON.stringify(raw);
}

test("a save from any earlier schema still opens", () => {
  const refused = [];
  for (let version = 2; version < STATE_SCHEMA_VERSION; version += 1) {
    try {
      const loaded = deserializeState(saveFromVersion(version));
      assert.equal(loaded.schemaVersion, STATE_SCHEMA_VERSION);
    } catch (error) {
      refused.push(`${version}: ${error.message}`);
    }
  }
  assert.deepEqual(
    refused,
    [],
    `these versions could no longer be opened:\n  ${refused.join("\n  ")}`
  );
});

test("a migrated save records the version it actually came from", () => {
  /* The shared branch used to write the literal 19 for whatever it was given,
     so a schema-20 save was told it had come from 19 and the integrity check
     refused it on the mismatch. */
  const previous = STATE_SCHEMA_VERSION - 1;
  const loaded = deserializeState(saveFromVersion(previous));
  assert.equal(loaded.replayBase.kind, "migration");
  assert.equal(loaded.replayBase.sourceSchemaVersion, previous);
  assert.equal(
    Number(loaded.replayBase.source.schemaVersion ?? loaded.replayBase.source.version),
    previous
  );
});

test("a save claiming to come from the future is still refused", () => {
  /* Loosening the check must not loosen it into accepting anything. Take a
     genuinely migrated save and move only the version it claims to have come
     from, so nothing else about it can be the reason it is refused. */
  const migrated = deserializeState(saveFromVersion(STATE_SCHEMA_VERSION - 1));
  const raw = JSON.parse(serializeState(migrated));
  const future = STATE_SCHEMA_VERSION + 1;
  raw.replayBase.sourceSchemaVersion = future;
  raw.replayBase.source.schemaVersion = future;
  raw.replayBase.source.version = future;
  sealState(raw);
  assert.throws(() => deserializeState(JSON.stringify(raw)));
});

test("a migrated save keeps the parish it was carrying", () => {
  /* Opening is not enough - the whole point of the migration is that the
     player's own village survives it. */
  const original = createGame("migrate-keeps-the-parish");
  const raw = JSON.parse(serializeState(original));
  raw.schemaVersion = STATE_SCHEMA_VERSION - 1;
  raw.version = STATE_SCHEMA_VERSION - 1;
  sealState(raw);

  const loaded = deserializeState(JSON.stringify(raw));
  assert.equal(loaded.town.name, original.town.name);
  assert.equal(loaded.residents.length, original.residents.length);
  assert.equal(loaded.residents[0].name, original.residents[0].name);
});
