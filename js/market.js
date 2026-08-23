/* ===========================================================================
   The market
   ---------------------------------------------------------------------------
   A village of two hundred souls does not have a market because a designer put
   one there. It has a market because some people grow grain, one of them mills
   it, another bakes it, and everybody else eats. If the miller takes to his bed
   the baker has nothing to work with, and by Sunday a loaf costs twice what it
   did.

   That is the whole idea here. Every good names the trades that make it and the
   goods it is made from. Each Sunday every producer in the parish is looked at
   one by one — their health, their illness, what is on their mind, whether
   their own house has food — and what the parish can actually make that week
   falls out of the sum of them. Then the chain is resolved in order, so a
   shortage upstream is felt downstream, and price follows from what is left
   against what the village needs.

   Nothing here is random. The same parish in the same condition produces the
   same market, which is what lets a player see that the baker's fever is the
   reason bread is dear.
   =========================================================================== */

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

/* Yields are per worker per week at full effectiveness, calibrated against the
   parish as it is actually generated: roughly three bakers, three millers, four
   farmers, two shepherds, two fishmongers and so on out of two hundred souls.
   They are set so a healthy parish sits a little above its own needs, which
   leaves a modest surplus for the church to buy and makes one sick producer a
   thing you can feel. */
export const TRADE_GOODS = Object.freeze({
  grain: {
    label: "Grain", unit: "sacks", stores: "grain",
    producers: ["farmer", "laborer", "reeve"], inputs: {},
    perWorker: 61, common: 1.1, needPerHead: 0.35, basePrice: 3, sellable: true,
    note: "Sown, reaped and threshed by the parish farmers."
  },
  flour: {
    label: "Flour", unit: "sacks", stores: null,
    producers: ["miller"], inputs: { grain: 1 },
    perWorker: 54, needPerHead: 0, basePrice: 4, sellable: false,
    note: "Ground at the mill from the parish's own grain."
  },
  bread: {
    label: "Bread", unit: "loaves", stores: "bread",
    producers: ["baker"], inputs: { flour: 0.2, firewood: 0.08 },
    perWorker: 137, common: 0.75, needPerHead: 1.6, basePrice: 1, sellable: true,
    note: "Baked from parish flour, over a parish fire."
  },
  ale: {
    label: "Ale", unit: "barrels", stores: null,
    producers: ["brewer", "innkeeper"], inputs: { grain: 1.6 },
    perWorker: 18, needPerHead: 0.2, basePrice: 6, sellable: false,
    note: "Brewed from grain, and competing with the baker for it."
  },
  beans: {
    label: "Dried beans", unit: "measures", stores: "beans",
    producers: ["farmer", "goatherd", "washerwoman"], inputs: {},
    perWorker: 23, common: 0.3, needPerHead: 0.42, basePrice: 2, sellable: true,
    note: "Grown in the garden plots and dried for winter."
  },
  onions: {
    label: "Onions", unit: "bundles", stores: "onions",
    producers: ["farmer", "servant", "stablehand"], inputs: {},
    perWorker: 31, common: 0.42, needPerHead: 0.55, basePrice: 1, sellable: true,
    note: "Pulled from the same garden plots as the beans."
  },
  fish: {
    label: "Fresh fish", unit: "fish", stores: null,
    producers: ["ferryman", "hunter"], inputs: {},
    perWorker: 30, common: 0.12, needPerHead: 0, basePrice: 2, sellable: false,
    note: "Taken from the water by those who work it."
  },
  salt: {
    label: "Salt", unit: "measures", stores: null,
    producers: ["merchant", "peddler"], inputs: {},
    perWorker: 12, common: 0.05, needPerHead: 0, basePrice: 5, sellable: false,
    note: "Carried in from outside; nobody here makes it."
  },
  saltedFish: {
    label: "Salted fish", unit: "fish", stores: "saltedFish",
    producers: ["fishmonger"], inputs: { fish: 1, salt: 0.12 },
    perWorker: 53, common: 0.05, needPerHead: 0.36, basePrice: 3, sellable: true,
    note: "Split and salted down so it will keep."
  },
  milk: {
    label: "Milk", unit: "pails", stores: null,
    producers: ["shepherd", "goatherd"], inputs: {},
    perWorker: 64, common: 1.4, needPerHead: 0, basePrice: 1, sellable: false,
    note: "From the flocks on the common ground."
  },
  cheese: {
    label: "Hard cheese", unit: "wheels", stores: "cheese",
    producers: ["shepherd", "goatherd", "servant"], inputs: { milk: 6, salt: 0.2 },
    perWorker: 11, common: 0.05, needPerHead: 0.22, basePrice: 5, sellable: true,
    note: "Pressed and salted so it will last the winter."
  },
  meat: {
    label: "Salt meat", unit: "joints", stores: null,
    producers: ["butcher"], inputs: { salt: 0.3 },
    perWorker: 20, needPerHead: 0.14, basePrice: 6, sellable: false,
    note: "Slaughtered and salted down by the butcher."
  },
  timber: {
    label: "Timber", unit: "loads", stores: null,
    producers: ["woodcutter", "forester"], inputs: {},
    perWorker: 43, common: 0.2, needPerHead: 0, basePrice: 3, sellable: false,
    note: "Felled and hauled from the woods."
  },
  firewood: {
    label: "Firewood", unit: "bundles", stores: "firewood",
    producers: ["woodcutter", "charcoal burner", "laborer"], inputs: { timber: 0.25 },
    perWorker: 62, common: 0.85, needPerHead: 1.15, basePrice: 1, sellable: true,
    note: "Split from the timber the woodmen bring in."
  },
  herbs: {
    label: "Herbs", unit: "bunches", stores: null,
    producers: ["herbalist", "forester"], inputs: {},
    perWorker: 11, common: 0.14, needPerHead: 0, basePrice: 2, sellable: false,
    note: "Gathered from the hedgerows and the wood's edge."
  },
  honey: {
    label: "Honey", unit: "jars", stores: null,
    producers: ["beekeeper"], inputs: {},
    perWorker: 14, common: 0.06, needPerHead: 0, basePrice: 4, sellable: false,
    note: "Taken from the hives, and needed by the healers."
  },
  medicine: {
    label: "Medicinal herbs", unit: "doses", stores: "medicine",
    producers: ["healer", "herbalist", "midwife"], inputs: { herbs: 1.4, honey: 0.3 },
    perWorker: 9, common: 0.02, needPerHead: 0.12, basePrice: 6, sellable: true,
    note: "Prepared by the healers from herbs and honey."
  },
  cloth: {
    label: "Cloth", unit: "ells", stores: null,
    producers: ["weaver", "spinner", "dyer"], inputs: {},
    perWorker: 9, needPerHead: 0.16, basePrice: 4, sellable: false,
    note: "Spun, woven and dyed by the cloth trades."
  },
  candles: {
    label: "Candles", unit: "dozen", stores: null,
    producers: ["candlemaker"], inputs: { honey: 0.4 },
    perWorker: 15, common: 0.06, needPerHead: 0.12, basePrice: 3, sellable: false,
    note: "Drawn from beeswax; the church burns a good many."
  }
});

export const TRADE_GOOD_KEYS = Object.freeze(Object.keys(TRADE_GOODS));

/* The goods the priest may actually buy: the ones the church has somewhere to
   put. He cannot carry home a load of timber. */
export const PURCHASABLE_GOODS = Object.freeze(
  TRADE_GOOD_KEYS.filter((key) => TRADE_GOODS[key].sellable && TRADE_GOODS[key].stores)
);

/* Inputs before outputs, so a shortage is always felt in the right order. */
function productionOrder() {
  const order = [];
  const placed = new Set();
  const place = (key, seen = new Set()) => {
    if (placed.has(key) || seen.has(key)) return;
    seen.add(key);
    for (const input of Object.keys(TRADE_GOODS[key].inputs)) place(input, seen);
    if (!placed.has(key)) {
      placed.add(key);
      order.push(key);
    }
  };
  for (const key of TRADE_GOOD_KEYS) place(key);
  return order;
}

const PRODUCTION_ORDER = Object.freeze(productionOrder());

/* ------------------------------------------------------- the producers ---- */

/* How much of a week's work one person can actually do. A man with a fever does
   not go to the mill; a man who has not eaten works badly; a man whose mind is
   elsewhere works badly too. */
export function producerEffectiveness(person, household) {
  if (!person.active || !person.alive) return 0;
  if (person.age < 14 || person.age > 72) return 0;

  let capacity = 1;
  if (person.illness) {
    /* An illness keeps you from work, and the longer it holds the less you do. */
    capacity *= person.illness === "lung sickness" ? 0.2 : 0.35;
    capacity *= Math.max(0.4, 1 - (person.illnessDays || 0) * 0.03);
  }
  if (person.injury) {
    capacity *= person.injury.severity >= 60 ? 0.15 : person.injury.severity >= 30 ? 0.5 : 0.8;
  }
  capacity *= clamp(person.health, 0, 100) / 100 * 0.5 + 0.5;
  /* Worry is not idleness, but it is not a full day's work either. */
  capacity *= 1 - Math.max(0, person.stress - 45) / 190;
  capacity *= 0.82 + clamp(person.morale, 0, 100) / 100 * 0.28;
  if (person.age > 62) capacity *= 0.7;
  else if (person.age < 17) capacity *= 0.6;
  if (household && household.food < 25) capacity *= 0.7;
  return Math.max(0, capacity);
}

/* Why a good is short this week, said in terms of people rather than numbers.
   This is the whole point of the system being made of named villagers. */
function impairmentNote(person, effectiveness) {
  if (effectiveness <= 0.05) {
    if (person.illness) return `${person.name} is abed with ${person.illness}`;
    if (person.injury) return `${person.name} is laid up ${person.injury.description}`;
    return `${person.name} is not at work`;
  }
  if (effectiveness < 0.55) {
    if (person.illness) return `${person.name} is working through ${person.illness}`;
    if (person.injury) return `${person.name} is hindered ${person.injury.description}`;
    if (person.stress > 70) return `${person.name} is too troubled to keep at it`;
    if (person.health < 45) return `${person.name} has little strength left`;
    if (person.morale < 30) return `${person.name} has lost heart for the work`;
    return `${person.name} is not managing a full week`;
  }
  return null;
}

function tradeCapacity(state, key) {
  const definition = TRADE_GOODS[key];
  const workers = [];
  let capacity = 0;
  let fullCapacity = 0;
  const notes = [];
  for (const person of state.residents) {
    if (!person.active || !person.alive) continue;
    const household = state.households.find((entry) => entry.id === person.householdId);
    const effectiveness = producerEffectiveness(person, household);

    /* Almost every household in an open-field village holds a strip and a
       garden, whatever trade the man of it follows. That common labour is what
       actually feeds the parish; the named trades add their craft on top. It
       also means one unlucky year of the dice cannot leave a village of two
       hundred with a single farmer and no bread. */
    if (definition.common && person.age >= 14 && person.age <= 70) {
      capacity += definition.common * effectiveness;
      fullCapacity += definition.common;
    }

    if (!definition.producers.includes(person.occupation)) continue;
    /* Several trades can make cheese or cut firewood, but for most of them it
       is a sideline, so only the first-named trade counts in full. */
    const share = definition.producers.indexOf(person.occupation) === 0 ? 1 : 0.6;
    capacity += definition.perWorker * effectiveness * share;
    fullCapacity += definition.perWorker * share;
    workers.push({ id: person.id, name: person.name, occupation: person.occupation, effectiveness });
    const note = impairmentNote(person, effectiveness);
    if (note) notes.push(note);
  }
  return { workers, capacity, fullCapacity, notes };
}

/* ------------------------------------------------------------ the week ---- */

const SEASON_YIELD = Object.freeze({
  grain: { Spring: 0.8, Summer: 1.1, Autumn: 1.3, Winter: 0.7 },
  beans: { Spring: 0.85, Summer: 1.2, Autumn: 1.2, Winter: 0.5 },
  onions: { Spring: 0.9, Summer: 1.2, Autumn: 1.25, Winter: 0.55 },
  milk: { Spring: 1.2, Summer: 1.15, Autumn: 0.9, Winter: 0.6 },
  fish: { Spring: 1.1, Summer: 1.05, Autumn: 1.0, Winter: 0.7 },
  herbs: { Spring: 1.25, Summer: 1.2, Autumn: 0.9, Winter: 0.4 },
  honey: { Spring: 0.9, Summer: 1.4, Autumn: 0.9, Winter: 0.2 },
  timber: { Spring: 1, Summer: 1, Autumn: 1.05, Winter: 0.85 }
});

const WEATHER_YIELD = Object.freeze({
  storm: { fish: 0.4, timber: 0.7, grain: 0.8 },
  snow: { grain: 0.6, timber: 0.6, fish: 0.6, herbs: 0.3 },
  frost: { grain: 0.75, herbs: 0.4, milk: 0.85 },
  cold: { herbs: 0.7, milk: 0.9 },
  heat: { milk: 0.8, grain: 0.95 },
  rain: { timber: 0.85, grain: 0.95 },
  sun: { grain: 1.1, honey: 1.15 },
  mild: {},
  wind: { fish: 0.85 }
});

/**
 * Work out what the parish can make this week, what it needs, and what a thing
 * therefore costs. Pure: it reads the parish and returns a board, touching
 * nothing, so it can be called freely to preview a market.
 */
export function calculateMarket(state) {
  const souls = state.residents.filter((person) => person.active && person.alive).length;
  const season = state.material?.season || "Spring";
  const weather = state.material?.weather || "mild";
  const prosperity = state.town?.metrics?.prosperity ?? 50;
  /* A sound mill, a bridge that carries a cart and roads a man can walk in
     February are the difference between labour and produce. Let them fall in
     and the same week's work yields less of everything. */
  const works = 0.82 + clamp(state.material?.infrastructure ?? 50, 0, 100) / 100 * 0.32;

  const goods = {};
  const labour = {};
  for (const key of PRODUCTION_ORDER) {
    const definition = TRADE_GOODS[key];
    const { workers, capacity, fullCapacity, notes } = tradeCapacity(state, key);
    const seasonFactor = SEASON_YIELD[key]?.[season] ?? 1;
    const weatherFactor = WEATHER_YIELD[weather]?.[key] ?? 1;
    labour[key] = {
      possible: capacity * seasonFactor * weatherFactor * works,
      potential: fullCapacity * seasonFactor * weatherFactor * works
    };
    goods[key] = {
      key,
      label: definition.label,
      unit: definition.unit,
      stores: definition.stores,
      sellable: definition.sellable,
      producers: workers,
      need: definition.needPerHead * souls,
      basePrice: definition.basePrice,
      workerNotes: notes,
      note: definition.note
    };
  }

  /* Settling the week.

     Two rules decide everything. People eat before workshops are supplied — the
     miller does not grind the last of the seed corn while the parish starves.
     And when several trades want the same thing, they share what is left in
     proportion to what they asked for, rather than whichever the code happens
     to consider first.

     Because a shortage of flour reduces what the baker asks for, which changes
     what is left of the grain, this has to settle rather than resolve in a
     single pass. A handful of rounds is ample for a chain this shallow. */
  const output = {};
  for (const key of PRODUCTION_ORDER) output[key] = labour[key].possible;
  let limits = {};

  for (let round = 0; round < 40; round += 1) {
    const claims = {};
    for (const key of PRODUCTION_ORDER) claims[key] = 0;
    for (const key of PRODUCTION_ORDER) {
      for (const [inputKey, perUnit] of Object.entries(TRADE_GOODS[key].inputs)) {
        claims[inputKey] += output[key] * perUnit;
      }
    }
    const shareOf = {};
    for (const key of PRODUCTION_ORDER) {
      /* What is actually left for the workshops is measured against what was
         actually made this round, not against what the trade could have made
         with unlimited materials. Measuring against the latter lets a shortage
         two links up the chain vanish, and lets bakers bake bread out of flour
         that was never milled. */
      /* Households eat first, but not to the last crumb. A village short of
         firewood burns a little less at home rather than shutting the bakehouse
         entirely, so the workshops keep a floor of what is made. Without it any
         subsistence deficit sets everything downstream to exactly zero, and the
         parish stops baking the moment it is slightly cold. */
      const spare = Math.max(output[key] * 0.25, output[key] - goods[key].need);
      shareOf[key] = claims[key] > 0 ? Math.min(1, spare / claims[key]) : 1;
    }
    limits = {};
    for (const key of PRODUCTION_ORDER) {
      let worst = 1;
      let limiting = null;
      for (const inputKey of Object.keys(TRADE_GOODS[key].inputs)) {
        if (shareOf[inputKey] < worst) {
          worst = shareOf[inputKey];
          limiting = inputKey;
        }
      }
      /* Approach the answer rather than jumping to it. Taken literally, an
         empty store tells every workshop to stop, which empties their claims,
         which tells them all to start again: the figures swing between nothing
         and everything forever and whichever round happens to be last decides
         the week. Moving part of the way each round settles instead. */
      const target = labour[key].possible * worst;
      output[key] = output[key] + (target - output[key]) * 0.5;
      limits[key] = worst < 0.98 ? limiting : null;
    }
  }

  /* The settling above approaches its answer from above, so the last round can
     still leave a workshop holding a few units more than were left for it.
     Trim each trade down to what its inputs genuinely covered, so the books
     balance exactly and nothing is made out of nothing. */
  for (let pass = 0; pass < 6; pass += 1) {
    const claims = {};
    for (const key of PRODUCTION_ORDER) claims[key] = 0;
    for (const key of PRODUCTION_ORDER) {
      for (const [inputKey, perUnit] of Object.entries(TRADE_GOODS[key].inputs)) {
        claims[inputKey] += output[key] * perUnit;
      }
    }
    let trimmed = false;
    for (const key of PRODUCTION_ORDER) {
      const spare = Math.max(output[key] * 0.25, output[key] - goods[key].need);
      if (claims[key] <= spare + 1e-9) continue;
      const share = claims[key] > 0 ? spare / claims[key] : 1;
      for (const consumer of PRODUCTION_ORDER) {
        if (!(key in TRADE_GOODS[consumer].inputs)) continue;
        output[consumer] *= share;
        trimmed = true;
      }
    }
    if (!trimmed) break;
  }

  const consumed = {};
  for (const key of PRODUCTION_ORDER) consumed[key] = 0;
  for (const key of PRODUCTION_ORDER) {
    for (const [inputKey, perUnit] of Object.entries(TRADE_GOODS[key].inputs)) {
      consumed[inputKey] += output[key] * perUnit;
    }
  }

  for (const key of PRODUCTION_ORDER) {
    goods[key].produced = output[key];
    goods[key].potential = labour[key].potential;
    goods[key].usedByOtherTrades = consumed[key];
    goods[key].limitingInput = limits[key];
  }

  /* Price. A village pays what scarcity demands, but a loaf never becomes a
     fortune and a glut never becomes free: there is a floor and a ceiling to
     what anyone will trade at. */
  for (const key of PRODUCTION_ORDER) {
    const good = goods[key];
    /* What is genuinely left over: what was made, less what the village ate and
       less what the other trades took as raw material. */
    const surplus = good.produced - good.need - good.usedByOtherTrades;
    const wanted = good.need + good.usedByOtherTrades;
    const ratio = wanted > 0
      ? wanted / Math.max(good.produced, wanted * 0.05)
      : 1;
    const scarcity = clamp(Math.pow(ratio, 0.85), 0.45, 3.6);
    /* A prosperous village bids goods up; a poor one cannot. */
    const purse = 0.85 + (prosperity / 100) * 0.3;
    const exact = good.basePrice * scarcity * purse;
    good.scarcity = scarcity;
    good.price = Math.max(1, Math.round(exact));
    good.exactPrice = exact;
    good.surplus = surplus;
    /* Only what the village does not need itself can be bought, and it will not
       sell the last of its margin to anyone, priest or no. */
    good.stock = good.sellable && good.stores
      ? Math.max(0, Math.floor(surplus * 0.55))
      : 0;
  }

  return {
    week: state.calendar?.week ?? 0,
    day: state.calendar?.absoluteDay ?? 0,
    season,
    weather,
    souls,
    goods
  };
}

/* A short plain sentence for each good the priest can buy, saying what it costs
   and, when it is dear, whose absence made it so. */
export function describeMarketGood(market, key) {
  const good = market.goods[key];
  if (!good) return "";
  const parts = [];
  if (good.stock <= 0) {
    parts.push(`No ${good.label.toLowerCase()} to be had this week.`);
  } else {
    parts.push(`${good.stock} ${good.unit} at ${good.price} ${good.price === 1 ? "penny" : "pennies"} each.`);
  }
  if (good.scarcity > 1.25) {
    const reasons = [];
    if (good.limitingInput) reasons.push(`there is not enough ${TRADE_GOODS[good.limitingInput].label.toLowerCase()}`);
    reasons.push(...good.workerNotes.slice(0, 2));
    if (!good.producers.length) reasons.push(`no one in the parish makes it any longer`);
    if (reasons.length) parts.push(`Dear this week: ${reasons.join("; ")}.`);
  } else if (good.scarcity < 0.75 && good.stock > 0) {
    parts.push("There is more than the village can eat, so it goes cheap.");
  }
  return parts.join(" ");
}

/** The lines shown on the market board, in a sensible order. */
export function marketListings(market) {
  return PURCHASABLE_GOODS.map((key) => {
    const good = market.goods[key];
    return {
      key,
      label: good.label,
      unit: good.unit,
      stores: good.stores,
      price: good.price,
      stock: good.stock,
      scarcity: good.scarcity,
      description: describeMarketGood(market, key)
    };
  }).sort((a, b) => b.stock * b.price - a.stock * a.price);
}
