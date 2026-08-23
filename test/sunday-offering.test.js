import test from "node:test";
import assert from "node:assert/strict";
import { createGame, applySermon, fallbackSermonOutcome, sundayAttendance } from "../js/simulation.js";
import { readSermonAppeal, readDonationRequest, collectSundayOffering } from "../js/church.js";

function sundayState(seed, priest = {}) {
  const state = createGame(seed);
  state.calendar.absoluteDay = 6;
  state.calendar.dayIndex = 6;
  state.calendar.week = 1;
  Object.assign(state.priest, priest);
  return state;
}

function preach(state, text, theme = "Charity") {
  const before = state.churchResources.coin;
  applySermon(state, theme, text, { ...fallbackSermonOutcome(state, theme, text), source: "fallback" });
  const event = state.events.find((entry) => entry.type === "sunday_offering");
  return { coin: state.churchResources.coin - before, givers: event?.facts.givers ?? 0, event };
}

const FAITHFUL = "Christ did not ask whether the hungry had earned their bread. Give what you can spare, and store treasure in heaven.";
const THREAT = "God will curse those who withhold from His church. Give, or face damnation.";

test("an appeal is read by its manner, not merely its presence", () => {
  assert.equal(readSermonAppeal("Be kind to one another.").asked, false);
  assert.equal(readSermonAppeal("Give what you can spare.").asked, true);
  assert.equal(readSermonAppeal(FAITHFUL).manner, "faithful");
  assert.equal(readSermonAppeal(THREAT).manner, "threatening");
  assert.equal(readSermonAppeal("The box is empty; give what you can spare.").manner, "practical");
});

test("asking raises the collection above what is given unprompted", () => {
  const silent = preach(sundayState("offer-silent"), "Be kind to one another this week, and mind your neighbours.");
  const asked = preach(sundayState("offer-asked"), FAITHFUL);
  assert.ok(asked.givers > silent.givers, "an appeal should move more households than silence");
  assert.ok(asked.coin > silent.coin);
});

test("some parishioners give without being asked", () => {
  const state = sundayState("offer-unprompted", { localTrust: 95, moralAuthority: 95 });
  const result = preach(state, "Be kind to one another this week, and mind your neighbours.");
  assert.ok(result.givers > 0, "a well-loved priest should be given something unasked");
});

test("a disgraced priest collects nothing, however he asks", () => {
  const state = sundayState("offer-disgraced", { scandal: 85, localTrust: 12, moralAuthority: 18 });
  const result = preach(state, FAITHFUL);
  assert.equal(result.coin, 0);
  assert.equal(result.givers, 0);
});

test("threatening yields more coin but costs moral authority and trust", () => {
  const kindly = sundayState("offer-kind");
  const kindResult = preach(kindly, FAITHFUL);

  const harsh = sundayState("offer-harsh");
  const authorityBefore = harsh.priest.moralAuthority;
  const harshResult = preach(harsh, THREAT);

  assert.ok(harshResult.coin > kindResult.coin, "fear should open more purses than faith alone");
  assert.ok(harsh.priest.moralAuthority < authorityBefore, "it should cost him standing");
});

test("nobody gives more than their household holds", () => {
  const state = sundayState("offer-bounds");
  for (const household of state.households) household.wealth = 1;
  const attendance = sundayAttendance(state);
  const result = collectSundayOffering(state, attendance, readSermonAppeal(FAITHFUL));
  for (const giver of result.givers) {
    assert.ok(giver.coin <= 1, `${giver.name} gave ${giver.coin} from a household holding 1`);
  }
  assert.ok(state.households.every((household) => household.wealth >= 0));
});

test("a hungry parish keeps its food", () => {
  const state = sundayState("offer-hungry");
  for (const household of state.households) household.food = 12;
  const result = collectSundayOffering(state, sundayAttendance(state), readSermonAppeal(FAITHFUL));
  assert.equal(result.grain, 0, "no one gives grain out of an empty larder");
});

test("the collection is recorded as an event with its manner", () => {
  const state = sundayState("offer-event");
  const result = preach(state, FAITHFUL);
  assert.ok(result.event, "a sunday_offering event should be written");
  assert.equal(result.event.facts.manner, "faithful");
  assert.equal(result.event.facts.asked, true);
});

test("asking one visitor is told apart from giving to them", () => {
  assert.equal(readDonationRequest("I will give you two loaves for your children.").asked, false);
  assert.equal(readDonationRequest("Take this bread, and go with God.").asked, false);
  assert.equal(readDonationRequest("Have you eaten today?").asked, false);
  assert.equal(readDonationRequest("The church needs firewood before winter.").asked, true);
  assert.equal(readDonationRequest("Can you spare anything for the poor box?").asked, true);
  assert.equal(readDonationRequest("God will curse those who withhold. Will you give to the church?").manner, "threatening");
});

test("the collection leaves the parish poorer by exactly what the church gained", () => {
  const state = sundayState("offer-conserved");
  const wealthBefore = state.households.reduce((total, household) => total + household.wealth, 0);
  const coinBefore = state.churchResources.coin;
  collectSundayOffering(state, sundayAttendance(state), readSermonAppeal(FAITHFUL));
  const wealthAfter = state.households.reduce((total, household) => total + household.wealth, 0);
  assert.equal(wealthBefore - wealthAfter, state.churchResources.coin - coinBefore);
});
