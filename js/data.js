export const WEEK_DAYS = Object.freeze([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
]);

export const CHURCH_RESOURCE_DEFINITIONS = Object.freeze({
  coin: { label: "Silver pennies", unit: "pennies", initial: 24, householdValue: 1 },
  grain: { label: "Grain", unit: "sacks", initial: 14, householdValue: 4 },
  bread: { label: "Bread", unit: "loaves", initial: 18, householdValue: 2 },
  beans: { label: "Dried beans", unit: "measures", initial: 12, householdValue: 2 },
  onions: { label: "Onions", unit: "bundles", initial: 16, householdValue: 1 },
  saltedFish: { label: "Salted fish", unit: "fish", initial: 8, householdValue: 2 },
  cheese: { label: "Hard cheese", unit: "wheels", initial: 6, householdValue: 2 },
  firewood: { label: "Firewood", unit: "bundles", initial: 20, householdValue: 1 },
  medicine: { label: "Medicinal herbs", unit: "doses", initial: 5, householdValue: 2 }
});

export const SESSION_LOCATIONS = Object.freeze({
  confessional: {
    name: "The Confessional",
    description: "Behind the purple curtain, where words may be spoken unseen.",
    visitor: { x: 282, y: 430 },
    priest: { x: 222, y: 430 },
    route: [{ x: 724, y: 995 }, { x: 570, y: 830 }, { x: 390, y: 650 }, { x: 282, y: 430 }]
  },
  office: {
    name: "The Parish Office",
    description: "A quiet table among ledgers, letters, and candle wax.",
    visitor: { x: 1190, y: 365 },
    priest: { x: 1120, y: 365 },
    route: [{ x: 724, y: 995 }, { x: 930, y: 800 }, { x: 1080, y: 585 }, { x: 1190, y: 365 }]
  },
  nave: {
    name: "The Main Nave",
    description: "An open place between the pews for ordinary counsel.",
    visitor: { x: 720, y: 665 },
    priest: { x: 645, y: 665 },
    route: [{ x: 724, y: 995 }, { x: 724, y: 830 }, { x: 720, y: 665 }]
  },
  shrine: {
    name: "Before the Shrine",
    description: "Near the altar, reserved for grave matters of faith, death, and conscience.",
    visitor: { x: 780, y: 330 },
    priest: { x: 700, y: 330 },
    route: [{ x: 724, y: 995 }, { x: 724, y: 760 }, { x: 740, y: 520 }, { x: 780, y: 330 }]
  }
});

export const SERMON_THEMES = Object.freeze([
  "Mercy", "Repentance", "Charity", "Duty", "Family", "Justice",
  "Humility", "Hope", "Community", "Temperance", "Forgiveness", "Courage"
]);

export const OCCUPATIONS = Object.freeze([
  "farmer", "shepherd", "miller", "baker", "brewer", "innkeeper", "blacksmith", "carpenter",
  "mason", "thatcher", "weaver", "spinner", "dyer", "tailor", "cobbler", "tanner",
  "butcher", "fishmonger", "herbalist", "midwife", "healer", "teacher", "scribe", "clerk",
  "reeve", "bailiff", "watchman", "soldier", "hunter", "forester", "woodcutter", "charcoal burner",
  "potter", "cooper", "candlemaker", "merchant", "peddler", "washerwoman", "servant", "laborer",
  "beekeeper", "goatherd", "stablehand", "ferryman", "gravedigger", "sexton", "sacristan", "unemployed"
]);

export const TRAITS = Object.freeze([
  "compassionate", "severe", "patient", "impulsive", "proud", "humble", "suspicious", "trusting",
  "dutiful", "rebellious", "generous", "miserly", "devout", "doubting", "hopeful", "melancholic",
  "candid", "secretive", "forgiving", "vengeful", "ambitious", "contented", "witty", "solemn",
  "fearful", "courageous", "industrious", "idle", "loyal", "fickle", "gentle", "quarrelsome"
]);

const HISTORICAL_MALE = [
  "Adam", "Adrian", "Alan", "Albert", "Aldous", "Anselm", "Arnold", "Arthur", "Bartholomew",
  "Benedict", "Bernard", "Bertram", "Clement", "Conrad", "Cornelius", "Crispin", "Daniel",
  "David", "Dominic", "Edgar", "Edmund", "Edward", "Elias", "Emery", "Erasmus", "Everard",
  "Felix", "Francis", "Frederick", "Gabriel", "Geoffrey", "George", "Gerard", "Gilbert",
  "Gregory", "Guy", "Henry", "Hugh", "Humphrey", "Isaac", "Jacob", "James", "Jasper",
  "Jerome", "John", "Jonas", "Joseph", "Julian", "Lambert", "Laurence", "Leonard", "Lucas",
  "Martin", "Matthew", "Maurice", "Michael", "Miles", "Nicholas", "Oliver", "Oswald",
  "Pascal", "Patrick", "Paul", "Peter", "Philip", "Ralph", "Randall", "Raymond", "Richard",
  "Robert", "Roger", "Roland", "Sebastian", "Simon", "Stephen", "Theobald", "Thomas",
  "Tobias", "Victor", "Vincent", "Walter", "William"
];

const HISTORICAL_FEMALE = [
  "Ada", "Agatha", "Agnes", "Alice", "Amabel", "Anne", "Aveline", "Barbara", "Beatrice",
  "Benedicta", "Blanche", "Bridget", "Catherine", "Cecily", "Christina", "Clara", "Constance",
  "Dorothy", "Edith", "Eleanor", "Elisabeth", "Ellen", "Emmeline", "Esther", "Felice",
  "Florence", "Frances", "Genevieve", "Grace", "Gundred", "Helena", "Isabel", "Joan",
  "Joanna", "Judith", "Juliana", "Katherine", "Lucy", "Mabel", "Margaret", "Margery",
  "Marian", "Martha", "Mary", "Matilda", "Maud", "Millicent", "Muriel", "Petronilla",
  "Philippa", "Prudence", "Rachel", "Rebecca", "Rose", "Sabina", "Sibyl", "Susanna",
  "Temperance", "Thomasina", "Ursula", "Winifred"
];

const NAME_PREFIXES = [
  "Ad", "Ael", "Al", "Am", "An", "Ar", "Aud", "Bald", "Bel", "Ber", "Bran", "Cad", "Cal",
  "Ced", "Cor", "Dan", "Ed", "El", "Em", "Er", "Ever", "Fen", "Ger", "Gil", "God", "Gwen",
  "Had", "Hal", "Hel", "Her", "Hugh", "Id", "Is", "Jan", "Jos", "Jul", "Lam", "Leo",
  "Lor", "Mar", "Mat", "Mer", "Mil", "Nor", "Odo", "Os", "Per", "Rad", "Ren", "Ric",
  "Rob", "Ros", "Seb", "Sig", "Sil", "Sim", "Ste", "The", "Thom", "Val", "Wal", "Wil"
];

const MALE_SUFFIXES = [
  "ard", "bert", "brand", "dric", "fred", "frey", "gar", "ger", "hard", "helm", "ian",
  "las", "mond", "nard", "old", "ric", "stan", "ton", "ward", "win", "wyn", "ias", "iel"
];
const FEMALE_SUFFIXES = [
  "a", "abel", "anne", "ella", "ette", "ina", "ine", "issa", "ora", "ria", "trice",
  "wen", "wyn", "ilda", "icia", "eline", "ette", "iana", "abel", "ith", "ude", "ence"
];

const HISTORICAL_SURNAMES = [
  "Abbott", "Archer", "Ashdown", "Atwood", "Baker", "Barber", "Barker", "Bell", "Bennett",
  "Black", "Blake", "Bowyer", "Brewster", "Briggs", "Brown", "Butcher", "Carter", "Chandler",
  "Chapman", "Clark", "Cliff", "Cook", "Cooper", "Croker", "Draper", "Dyer", "Fisher",
  "Fletcher", "Ford", "Forester", "Fowler", "Fuller", "Gardiner", "Glover", "Goodman",
  "Granger", "Green", "Grey", "Harper", "Hayward", "Hill", "Hunt", "Joyner", "Keene",
  "Kemp", "King", "Lane", "Lister", "Long", "Mason", "Mercer", "Miller", "Page", "Palmer",
  "Parker", "Payne", "Pike", "Potter", "Read", "Reeve", "Roper", "Sawyer", "Shepherd",
  "Slater", "Smith", "Spencer", "Stone", "Taylor", "Thatcher", "Turner", "Walker", "Ward",
  "Weaver", "Webb", "Wheeler", "White", "Wood", "Wright"
];

const SURNAME_PREFIXES = [
  "Alder", "Apple", "Ash", "Barley", "Beech", "Bell", "Black", "Briar", "Broad", "Brook",
  "Candle", "Clay", "Clear", "Cold", "Crow", "Dove", "East", "Elm", "Fair", "Far",
  "Fern", "Field", "Flint", "Fox", "Gold", "Good", "Green", "Grey", "Hart", "Haw",
  "Hazel", "High", "Hollow", "Honey", "Iron", "Keen", "Lake", "Lark", "Little", "Long",
  "Marsh", "Meadow", "Mere", "Moss", "North", "Oak", "Old", "Otter", "Pear", "Pine",
  "Quick", "Rain", "Red", "Reed", "Rook", "Rose", "Rowan", "Sedge", "Silver", "Small",
  "South", "Sparrow", "Spring", "Stone", "Strong", "Summer", "Swift", "Thorn", "Under",
  "Vale", "West", "White", "Wild", "Willow", "Winter", "Wood", "Wren"
];
const SURNAME_SUFFIXES = [
  "bank", "brook", "bury", "combe", "croft", "dale", "field", "ford", "gate", "ham",
  "hurst", "ing", "ley", "man", "mere", "mill", "moor", "ridge", "shaw", "stead",
  "stone", "ton", "vale", "ward", "water", "well", "wick", "wood", "wright", "worth"
];

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function buildFirstNameBank(sex) {
  const bank = new Set(sex === "female" ? HISTORICAL_FEMALE : HISTORICAL_MALE);
  const suffixes = sex === "female" ? FEMALE_SUFFIXES : MALE_SUFFIXES;
  for (const prefix of NAME_PREFIXES) {
    for (const suffix of suffixes) {
      bank.add(titleCase(`${prefix}${suffix}`));
      bank.add(titleCase(`${prefix}${suffix.replace(/^[aeiou]/, "")}`));
    }
  }
  return [...bank];
}

export function buildSurnameBank() {
  const bank = new Set(HISTORICAL_SURNAMES);
  for (const prefix of SURNAME_PREFIXES) {
    for (const suffix of SURNAME_SUFFIXES) {
      bank.add(titleCase(`${prefix}${suffix}`));
    }
  }
  return [...bank];
}

export const BACKSTORY_PARTS = Object.freeze({
  origins: [
    "was raised above a noisy workshop", "grew up in a one-room cottage beside the common",
    "was fostered by an aunt after a winter fever", "spent childhood following sheep over wet hills",
    "was born during a failed harvest", "grew up behind the village inn", "was raised by a widowed parent",
    "came from a household known for strict piety", "was the overlooked child of a large family",
    "grew up beside the mill race", "was once a servant in a distant manor", "was found as an infant at the chapel door",
    "was raised among charcoal burners", "learned letters from an aging clerk", "spent youth on a river barge",
    "grew up in a prosperous merchant household", "was raised by grandparents", "survived a house fire as a child",
    "came to the village after border violence", "was born into a family burdened by debt"
  ],
  turns: [
    "lost a sibling through preventable illness", "made an enemy over an inheritance", "married for affection against family wishes",
    "broke a promise that still troubles the conscience", "saved a neighbor during a flood", "was publicly shamed for a false accusation",
    "inherited tools but not the skill to use them", "returned from military service changed in temperament",
    "quietly supports a poor relation", "once stole food during a famine", "was betrayed by a trusted friend",
    "saw a parent driven from work by injury", "gave up a desired vocation for family duty",
    "holds evidence of another household's wrongdoing", "was forgiven an old offense and never forgot it",
    "survived a dangerous childbirth", "lost savings to a dishonest bargain", "is secretly teaching a child to read",
    "owes prosperity to a rival's misfortune", "believes a recent death was not accidental"
  ],
  pressures: [
    "fears the household will go hungry", "is torn between duty and private longing", "dreads public disgrace",
    "wants revenge but fears damnation", "cannot decide whether to forgive", "is hiding a worsening illness",
    "worries that a child has fallen into bad company", "suspects a spouse of betrayal", "feels trapped in an unsuitable trade",
    "is tempted by money that is not rightfully theirs", "has begun to doubt long-held beliefs",
    "is exhausted by caring for an elderly relative", "wants to confess before rumors spread",
    "believes the village has treated the family unjustly", "is considering leaving the village",
    "has promised help to two people and can satisfy only one", "is ashamed of feeling relief after a death",
    "fears a violent neighbor", "has fallen in love with an unsuitable person", "knows a secret that could ruin three households"
  ],
  textures: [
    "keeps every scrap of ribbon", "never enters a room without counting the exits", "sings while working",
    "cannot bear the smell of smoke", "writes names in the margins of old receipts", "feeds stray dogs",
    "collects smooth river stones", "speaks softly when angry", "laughs at funerals from nervousness",
    "wears a dead relative's ring", "rises before dawn even when ill", "avoids looking at the church bell",
    "brings small gifts but refuses thanks", "remembers every slight", "quotes proverbs incorrectly",
    "is known for unusually fine penmanship", "hums the same hymn under stress", "never drinks ale",
    "leaves bread at an unknown grave", "has a habit of finishing other people's sentences"
  ]
});

export const ISSUE_TEMPLATES = Object.freeze([
  { kind: "confession", location: "confessional", gravity: 4, opening: "Father, I have done something I cannot speak of where another soul might hear." },
  { kind: "confession", location: "confessional", gravity: 3, opening: "Bless me, Father. I have carried a lie for many months, and it has begun to poison my household." },
  { kind: "confession", location: "confessional", gravity: 5, opening: "Father, I fear my anger may already have set a terrible thing in motion." },
  { kind: "private counsel", location: "office", gravity: 2, opening: "Father, I need plain counsel about my work and those who depend upon me." },
  { kind: "family counsel", location: "office", gravity: 3, opening: "There is a matter in my family that cannot be settled at our own table." },
  { kind: "dispute", location: "office", gravity: 3, opening: "I have been wronged, Father, and I want to know what justice permits me to do." },
  { kind: "ordinary talk", location: "nave", gravity: 1, opening: "I did not come with a grand matter, Father. I only hoped someone might listen." },
  { kind: "village concern", location: "nave", gravity: 2, opening: "People are speaking carelessly in the village. I wonder whether I should answer them." },
  { kind: "decision", location: "nave", gravity: 2, opening: "A choice lies before me, and every path seems to cost another person something." },
  { kind: "grief", location: "shrine", gravity: 4, opening: "Father, I cannot make peace with the death that has come to our house." },
  { kind: "faith", location: "shrine", gravity: 4, opening: "I pray and hear only my own fear. I need to know whether faith can survive doubt." },
  { kind: "grave conscience", location: "shrine", gravity: 5, opening: "Before the altar I feel the weight of what I may yet do. Tell me how to turn aside." }
]);

export const ACTION_TYPES = Object.freeze([
  "comfort", "advise", "apologize", "forgive", "reconcile", "pray_with", "share_food", "lend_money",
  "donate", "shelter", "teach", "heal", "nurse", "work_harder", "shirk_work", "change_job", "quit_job",
  "hire", "lower_prices", "raise_prices", "repair", "build", "neglect", "court", "marry", "separate",
  "divorce", "conceive_child", "adopt_child", "invite_migrant", "leave_village", "expel", "accuse",
  "gossip", "reveal_secret", "conceal_secret", "steal", "return_stolen_goods", "vandalize", "threaten",
  "assault", "report_crime", "arrest", "release", "begin_feud", "make_peace", "celebrate", "mourn",
  "fast", "drink", "gamble", "repent", "relapse", "testify", "evict", "visit", "write_letter",
  "organize_aid", "protest", "attend_church", "avoid_church", "seek_absolution", "keep_silence",
  "confess_publicly", "protect", "betray", "offer_work", "refuse_work", "move_household"
  , "flirt_with_priest", "proposition_priest", "attempt_seduction", "blackmail_priest",
  "report_priest_to_bishop", "praise_priest_to_bishop", "attack_priest", "poison_priest",
  "kill_priest", "defend_priest", "challenge_priest", "petition_bishop", "appeal_to_rome",
  "petition_crown", "claim_miracle", "fake_miracle", "claim_prophecy", "play_prank",
  "wear_disguise", "release_livestock_in_church", "stage_public_penance", "start_procession",
  "ring_bells_at_midnight", "steal_church_relic", "return_church_relic", "seek_sanctuary",
  "improvise"
]);

export const PHASE_ZERO_SAFE_ACTIONS = Object.freeze([
  "comfort", "advise", "apologize", "forgive", "reconcile", "pray_with", "share_food",
  "lend_money", "donate", "shelter", "teach", "heal", "nurse", "work_harder", "shirk_work",
  "change_job", "quit_job", "hire", "lower_prices", "raise_prices", "repair", "build", "neglect",
  "accuse", "gossip", "reveal_secret", "conceal_secret", "return_stolen_goods",
  "report_crime", "make_peace", "celebrate", "mourn", "fast", "repent", "testify", "visit",
  "write_letter", "organize_aid", "protest", "attend_church", "avoid_church", "seek_absolution",
  "keep_silence", "confess_publicly", "protect", "offer_work", "refuse_work", "improvise"
]);

export const PHASE_TWO_LIFE_ACTIONS = Object.freeze([
  "court", "marry", "separate", "conceive_child", "adopt_child",
  "invite_migrant", "leave_village", "change_job"
]);

export const PHASE_THREE_RISK_ACTIONS = Object.freeze([
  "steal", "vandalize", "threaten", "assault", "begin_feud", "evict", "betray",
  "drink", "gamble", "relapse", "expel", "divorce", "move_household"
]);

export const PHASE_FOUR_PRIEST_ACTIONS = Object.freeze([
  "flirt_with_priest", "proposition_priest", "attempt_seduction", "blackmail_priest",
  "report_priest_to_bishop", "praise_priest_to_bishop", "attack_priest", "poison_priest",
  "kill_priest", "defend_priest", "challenge_priest", "play_prank",
  "release_livestock_in_church", "ring_bells_at_midnight", "steal_church_relic",
  "return_church_relic", "claim_miracle", "fake_miracle", "claim_prophecy"
]);

export const PHASE_FIVE_AUTHORITY_ACTIONS = Object.freeze([
  "petition_bishop", "appeal_to_rome", "petition_crown", "claim_miracle", "fake_miracle"
]);

export const AI_ALLOWED_ACTIONS = Object.freeze([
  ...PHASE_ZERO_SAFE_ACTIONS,
  ...PHASE_TWO_LIFE_ACTIONS,
  ...PHASE_THREE_RISK_ACTIONS,
  ...PHASE_FOUR_PRIEST_ACTIONS,
  ...PHASE_FIVE_AUTHORITY_ACTIONS
]);

export const EXTERNAL_ROLES = Object.freeze({
  archdeacon: {
    title: "Archdeacon",
    names: ["Anselm Vane", "Crispin Wycliffe", "Jerome Bell", "Edmund Harcourt"],
    opening: "Father, word has reached the cathedral chapter. I have come to learn whether rumor or disorder governs this parish.",
    location: "office",
    sprite: 0
  },
  bishop: {
    title: "Bishop",
    names: ["Bishop Thomas Rook", "Bishop Clement Vale", "Bishop Adrian More", "Bishop Benedict Grey"],
    opening: "My son, reports from this parish have become too numerous to answer by letter. We will speak plainly before I judge them.",
    location: "shrine",
    sprite: 0
  },
  inquisitor: {
    title: "Ecclesiastical Examiner",
    names: ["Doctor Erasmus Pike", "Canon Matthew Crowe", "Father Dominic Ward"],
    opening: "I have been charged to examine certain claims, teachings, and disturbances said to have begun here.",
    location: "office",
    sprite: 0
  },
  papal_legate: {
    title: "Papal Legate",
    names: ["Cardinal Lorenzo Vieri", "Cardinal Matteo Orsini", "Legate Girolamo Conti"],
    opening: "I carry authority from Rome. What began as village rumor has crossed diocesan boundaries, and now requires an account.",
    location: "shrine",
    sprite: 0
  },
  pope: {
    title: "The Holy Father",
    names: ["Pope Clement", "Pope Leo", "Pope Paul"],
    opening: "Few parish priests receive such a visit, and fewer still for peaceful reasons. Speak honestly; the road to this church has been long.",
    location: "shrine",
    sprite: 0
  },
  sheriff: {
    title: "Royal Sheriff",
    names: ["Sheriff Walter Ashby", "Sheriff Hugh Marlow", "Sheriff Roger Flint"],
    opening: "The Crown has heard of violence and disorder in this village. I have come to decide whether arrests or protection are required.",
    location: "nave",
    sprite: 12
  },
  steward: {
    title: "Manor Steward",
    names: ["Steward Oswyn Page", "Steward Robert Crowe", "Steward Alice Vane"],
    opening: "Father, concerns from the village have begun to interfere with the manor's work. I have come to hear the accusation and the evidence separately.",
    location: "office",
    sprite: 28
  },
  magistrate: {
    title: "County Magistrate",
    names: ["Magistrate Edmund Hale", "Magistrate Joan Marlow", "Magistrate Walter Fane"],
    opening: "A village dispute has grown beyond private counsel. I will hear what is known, what is merely believed, and what remedy the law can actually provide.",
    location: "office",
    sprite: 28
  },
  lord: {
    title: "Lord of the Manor",
    names: ["Lord Edmund Alder", "Lady Beatrice Thorn", "Lord Simon Wren"],
    opening: "Father, your influence now touches matters of land, labor, and order. I have come because this dispute can no longer be governed at a distance.",
    location: "nave",
    sprite: 35
  },
  royal_commissioner: {
    title: "Royal Commissioner",
    names: ["Sir Gilbert Fane", "Lady Alice Mortimer", "Master Robert Cecil"],
    opening: "A petition from this village has reached the royal household. I am here to discover what truth survives beneath it.",
    location: "office",
    sprite: 28
  },
  king: {
    title: "The King",
    names: ["King Henry", "King Edward", "King James"],
    opening: "Your village has become troublesome enough, useful enough, or curious enough to draw the Crown in person. Tell me which it is.",
    location: "nave",
    sprite: 28
  },
  physician: {
    title: "Traveling Physician",
    names: ["Doctor Julian Fenn", "Doctor Sabina Grey", "Doctor Elias Webb"],
    opening: "I was summoned because blood has been spilled near holy ground. Show me the wound, and tell me who profits from your silence.",
    location: "office",
    sprite: 22
  },
  noble: {
    title: "Visiting Noble",
    names: ["Lady Beatrice Wren", "Lord Simon Alder", "Lady Margaret Thorn"],
    opening: "The affairs of this parish now touch land, rents, and reputation beyond the village. I would hear your account before choosing a side.",
    location: "office",
    sprite: 35
  }
});

export const TOWN_NAMES = Object.freeze([
  "Bellweather", "Aldermere", "Saint Orison", "Crowmarsh", "Hearthwick", "Dunlow",
  "Ashcombe", "Morrowfield", "Roseford", "Barrowden", "Wrenhurst", "Candlebrook"
]);

export const TOWN_LANDSCAPES = Object.freeze([
  "a damp river valley crossed by an old stone bridge",
  "a high chalk ridge where wind bends every orchard",
  "a wooded basin surrounding a cold, dark mere",
  "a broad patchwork of barley fields and sheep pasture",
  "a marsh-edge settlement built along raised timber roads",
  "a steep valley beneath an abandoned hill fort"
]);

export const TOWN_CHARACTERS = Object.freeze([
  "Its people are proud of surviving hard winters and slow to trust outsiders.",
  "Old families keep careful account of favors, marriages, and insults.",
  "The village is outwardly prosperous, though debt binds many households together.",
  "Pilgrims pass nearby, bringing coin, rumor, temptation, and occasional disease.",
  "A recent fire forced rivals to rebuild beside one another.",
  "The manor's weak authority leaves the parish to settle most disputes itself."
]);

export const TOWN_TENSIONS = Object.freeze([
  "This year, poor grain and rising rents have made charity a political question.",
  "A disputed inheritance divides three of the largest households.",
  "Young laborers are leaving for a distant market town.",
  "A sickness among cattle threatens winter food and several livelihoods.",
  "Rumors of heresy have made sincere doubt dangerous to admit.",
  "The reeve's harsh punishments have reduced theft while multiplying resentment."
]);
