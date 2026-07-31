import { advancePopulationDay } from "../js/population.js";
import { createGame } from "../js/simulation.js";

const seeds = ["year-balance-a", "year-balance-b", "year-balance-c"];
for (const seed of seeds) {
  const state = createGame(seed);
  for (let day = 1; day <= 365; day += 1) {
    state.calendar.absoluteDay = day;
    state.calendar.dayIndex = day % 7;
    state.calendar.week = Math.floor(day / 7) + 1;
    state.calendar.slot = 0;
    advancePopulationDay(state);
  }
  const living = state.residents.filter((person) => person.active && person.alive).length;
  console.log(JSON.stringify({
    seed,
    living,
    totalRegistered: state.residents.length,
    births: state.statistics.births,
    arrivals: state.statistics.arrivals,
    departures: state.statistics.departures,
    material: state.material,
    town: state.town.metrics
  }));
}
