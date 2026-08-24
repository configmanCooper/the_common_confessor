const FAMILIES = [
  ["embezzled_grain", ["confession", "decision"], "{person} diverted {sum} sacks of grain from the manor reserve.", "{victim} is blamed for the missing grain and may be punished.", "Return the grain, clear the accusation, and request emergency food openly."],
  ["false_accusation", ["confession", "dispute"], "{relation} accused an innocent apprentice of theft.", "{person} knows who actually took the goods but fears retaliation.", "Give the evidence to a neutral witness before confronting the accuser."],
  ["coerced_marriage", ["family counsel", "decision"], "{relation} arranged a marriage to settle a household debt.", "The unwilling bride or groom fears violence and loss of shelter.", "Delay the betrothal and create a separate repayment plan."],
  ["forged_inheritance", ["confession", "dispute"], "A forged inheritance paper gives {relation} control of a cottage and {sum} acres.", "{victim} holds the stronger lawful claim but lacks the original deed.", "Place the suspect paper and the surviving claim evidence with an independent clerk, then summon the witnesses."],
  ["poaching_for_hunger", ["confession", "decision"], "{person} poached game from the lord's wood to feed hungry households.", "{victim} has been arrested for the poaching.", "Confess with witnesses and offer restitution in labor or coin."],
  ["withheld_wages", ["dispute", "private counsel"], "{relation} withheld {sum} days of wages after the poor harvest.", "{person}'s household needs the money, but immediate payment may close the workshop.", "Agree to staged repayment secured by written witnesses."],
  ["dangerous_apprentice", ["village concern", "decision"], "An apprentice is being beaten and sent into unsafe night work by {relation}.", "Removing the child also removes food, shelter, and training.", "Arrange temporary fostering and a different apprenticeship."],
  ["hidden_contagion", ["confession", "private counsel"], "{person} concealed a fever and continued sharing meals and tools.", "{relation}'s household may already have been exposed.", "Warn the exposed households and isolate without public shaming."],
  ["adulterated_ale", ["village concern", "dispute"], "{relation} is selling weak ale and may be adding unsafe herbs to disguise it.", "Several laborers are ill, and {victim} is blamed for poor brewing.", "Separate the fraud question from the illness: stop the batch, examine the barrels and sick drinkers, then repay buyers if the measure was false."],
  ["false_weights", ["confession", "dispute"], "{person} used a short market measure at {relation}'s request.", "The hidden loss falls most heavily on poor buyers.", "Use an honest public measure and repay frequent customers."],
  ["boundary_stones", ["dispute", "decision"], "Someone moved boundary stones near {resource}.", "{relation} gained land while {victim} lost grazing and rent.", "Restore the stones using elderly witnesses who remember the line."],
  ["blocked_watercourse", ["village concern", "dispute"], "{relation} diverted the mill stream toward private land.", "{victim}'s field and workshop now receive too little water.", "Set timed water rights and reopen part of the old channel."],
  ["smuggled_goods", ["confession", "decision"], "{person} helped move untaxed cloth through the village at night.", "{official} suspects {victim}, who had no part in it.", "Reveal the route, repay the duty, and protect the innocent suspect."],
  ["hidden_fire", ["confession", "village concern"], "{person} caused a workshop fire through negligence and concealed the cause.", "{relation} is being charged for faulty construction.", "Admit the neglected flame and help rebuild the damaged shop."],
  ["household_violence", ["family counsel", "grave conscience"], "{victim} is being struck and threatened inside the household.", "Public confrontation may provoke worse violence that night.", "Arrange immediate shelter before confronting the violent person."],
  ["secret_pregnancy", ["family counsel", "private counsel"], "A young woman entrusted {person} with a hidden pregnancy.", "Her household may respond with violence if the father is named.", "Secure shelter and a midwife before any public disclosure."],
  ["abandoned_elder", ["village concern", "private counsel"], "{victim} has been left without food or firewood by adult children.", "The children claim poverty, but one household has adequate stores.", "Divide care among kin and parish volunteers with a written schedule."],
  ["stolen_relic", ["private counsel", "faith"], "A church relic was stolen and sold to pay a healer.", "Naming the thief reveals {victim}'s private illness.", "Repurchase the relic first, then resolve restitution privately."],
  ["grave_robbery", ["grave conscience", "village concern"], "{relation} opened a recent grave searching for jewelry.", "The dead person's family believes animals disturbed the burial.", "Restore the grave, secure the goods, and decide how the truth can be disclosed without further desecration."],
  ["blackmail_letter", ["confession", "decision"], "{person} possesses a letter that could disgrace {relation}.", "Using it would erase a debt but destroy a household's standing.", "Seal the letter with a neutral witness and negotiate without threats."],
  ["bribed_watch", ["village concern", "dispute"], "A watchman accepted coin to ignore night thefts near {resource}.", "{victim} was robbed twice and now plans private revenge.", "Report the bribe to the reeve and compensate victims from seized coin."],
  ["corrupt_tax", ["dispute", "decision"], "{official} demanded more tax than the written assessment.", "Households that cannot pay may lose tools before winter.", "Collect copies of receipts and appeal the excess together."],
  ["hidden_deserter", ["confession", "decision"], "{person} is sheltering a soldier who deserted after witnessing cruelty.", "Discovery may bring punishment on the entire household.", "Seek sanctuary terms and testimony before the patrol returns."],
  ["forbidden_courtship", ["family counsel", "decision"], "{relation} and {victim} are courting against both households' wishes.", "A secret marriage could begin a feud and leave them homeless.", "Use a public delay to test consent and negotiate household terms."],
  ["exploited_children", ["village concern", "decision"], "{relation} employs young children through dangerous winter nights.", "Their wages feed their households, but one child has already been injured.", "Limit the hours and replace the lost wages through parish aid."],
  ["market_monopoly", ["decision", "dispute"], "{relation} seeks exclusive rights to sell at the village market.", "{victim} and several small traders would lose all customers.", "Grant rotating stalls or limit exclusivity to one season."],
  ["price_gouging", ["village concern", "decision"], "{relation} doubled grain prices while keeping a private reserve.", "Hungry households are selling tools to buy food.", "Publish the reserve, cap emergency prices, and repay later through fair trade."],
  ["false_charity", ["village concern", "private counsel"], "{relation}'s household receives church food while hiding full grain bins.", "The deception is draining aid from families in true need.", "Protect vulnerable members, verify the stores, and revise aid only after the household is heard."],
  ["panic_rumor_armed", ["ordinary talk", "village concern"], "A rumor says an armed company is approaching {town}.", "Families are hoarding food and preparing to flee, though no banner, commander, number, or intention has been confirmed.", "Compare road reports, ask the watch and manor officers what they know, and prepare proportionate precautions without announcing an invasion as fact."],
  ["panic_rumor_sickness", ["ordinary talk", "village concern"], "A rumor says travelers carrying a dangerous sickness are approaching {town}.", "Families are hoarding food and avoiding strangers, though no sick traveler, symptom pattern, or place of exposure has been confirmed.", "Ask healers and road witnesses what they observed, prepare care and separation if symptoms appear, and do not announce a pestilence without evidence."],
  ["witchcraft_accusation", ["village concern", "grave conscience"], "{victim} is accused of witchcraft after a child's unexplained illness.", "Fear is becoming a mob, though no witness saw wrongdoing.", "Protect the accused, investigate the illness, and forbid vigilante punishment."],
  ["missing_person", ["village concern", "family counsel"], "{relation} vanished after traveling near {resource}.", "One household suspects flight from debt; another fears violence.", "Organize a search while keeping unproven accusations private."],
  ["unsafe_bridge", ["village concern", "decision"], "The bridge near {resource} is close to collapse.", "{official} refuses repair until after tax collection.", "Close the bridge, organize labor, and seek written reimbursement."],
  ["contaminated_well", ["village concern", "private counsel"], "Several households became ill after drawing from the common well.", "{relation} dumped tanning waste nearby but denies responsibility.", "Close the well, secure clean water, and inspect the runoff."],
  ["midwife_error", ["grave conscience", "private counsel"], "{victim}'s birth went badly, and the midwife concealed a serious mistake.", "The grieving family blames divine punishment instead of negligence.", "Preserve the medical evidence, protect the grieving household, and decide how the truth and restitution should be handled."],
  ["healer_secret", ["private counsel", "decision"], "A healer knows a popular remedy is ineffective but keeps selling it, and {victim} has been paying for it all winter.", "Desperate families spend scarce coin while real treatment is delayed.", "Stop presenting the remedy as proven, compare patient outcomes, and arrange repayment or alternative care."],
  ["debt_imprisonment", ["decision", "village concern"], "{victim} may be imprisoned over a debt of {sum} silver pennies.", "The creditor is lawful but using imprisonment to seize the workshop.", "Raise part of the debt and negotiate labor for the remainder."],
  ["orphan_guardianship", ["family counsel", "decision"], "{victim} was left an orphan with a small inheritance, and {relation}'s household now claims the guardianship against another.", "One household offers affection; the other offers stability but expects control of the property.", "Separate guardianship from management of the inheritance."],
  ["feast_store_theft", ["village concern", "decision"], "Food reserved for a holy-day feast has disappeared, and {relation} held the storehouse key.", "{victim} is blamed because of an old reputation for theft.", "Audit the storehouse keys and accounts, secure replacement food if possible, and accuse no one until evidence distinguishes theft from error."],
  ["illegal_enclosure", ["dispute", "village concern"], "{relation} fenced part of the common field without consent.", "Poor households can no longer graze goats or gather fuel.", "Remove part of the fence and negotiate a limited private allotment."],
  ["sanctuary_fugitive", ["faith", "decision"], "{relation} has claimed sanctuary in the church after injuring a watchman.", "The watch demands surrender, while {relation} claims self-defense.", "Hear witnesses under sanctuary before negotiating a lawful handover."]
];

const ACCESS = Object.freeze({
  manor: ["reeve", "bailiff", "clerk", "scribe", "servant", "stablehand", "miller", "farmer", "merchant", "laborer"],
  records: ["reeve", "bailiff", "clerk", "scribe", "merchant", "teacher"],
  market: ["merchant", "peddler", "baker", "brewer", "butcher", "fishmonger", "weaver", "dyer", "tailor", "cobbler", "tanner", "potter", "cooper", "candlemaker", "farmer", "miller"],
  land: ["farmer", "shepherd", "goatherd", "beekeeper", "woodcutter", "forester", "hunter", "miller", "ferryman"],
  workshop: ["blacksmith", "carpenter", "mason", "thatcher", "weaver", "dyer", "tailor", "cobbler", "tanner", "potter", "cooper", "candlemaker", "miller", "baker", "brewer"],
  health: ["healer", "herbalist", "midwife", "washerwoman", "servant", "sexton", "sacristan", "gravedigger"],
  church: ["sexton", "sacristan", "gravedigger", "clerk", "scribe", "teacher", "servant"],
  watch: ["watchman", "soldier", "reeve", "bailiff", "hunter", "forester"],
  travel: ["peddler", "merchant", "ferryman", "soldier", "hunter", "forester", "servant"],
  household: ["washerwoman", "servant", "midwife", "healer", "teacher", "unemployed"]
});

const FAMILY_ACCESS = Object.freeze({
  embezzled_grain: { groups: ["manor"], public: false },
  false_accusation: { groups: ["market", "workshop", "watch"], public: true },
  coerced_marriage: { groups: ["household", "records"], public: true, minimumAge: 16 },
  forged_inheritance: { groups: ["records", "manor"], public: false, minimumAge: 18 },
  poaching_for_hunger: { groups: ["land", "watch"], public: true },
  withheld_wages: { groups: ["workshop", "market"], public: false, minimumAge: 14 },
  dangerous_apprentice: { groups: ["workshop", "household"], public: true },
  hidden_contagion: { groups: ["health", "market", "household"], public: true },
  adulterated_ale: { groups: ["market", "health"], public: true },
  false_weights: { groups: ["market"], public: true },
  boundary_stones: { groups: ["land", "records"], public: true },
  blocked_watercourse: { groups: ["land", "workshop"], public: true },
  smuggled_goods: { groups: ["travel", "market", "watch"], public: false },
  hidden_fire: { groups: ["workshop", "watch"], public: true },
  household_violence: { groups: ["household", "health", "watch"], public: true },
  secret_pregnancy: { groups: ["health", "household"], public: false, minimumAge: 16 },
  abandoned_elder: { groups: ["household", "health", "church"], public: true },
  stolen_relic: { groups: ["church", "market", "travel"], public: false },
  grave_robbery: { groups: ["church", "watch", "health"], public: false },
  blackmail_letter: { groups: ["records", "manor", "market"], public: false, minimumAge: 18 },
  bribed_watch: { groups: ["watch", "market"], public: true },
  corrupt_tax: { groups: ["manor", "records", "market", "land"], public: true },
  hidden_deserter: { groups: ["watch", "travel", "household"], public: false },
  forbidden_courtship: { groups: ["household", "church"], public: true, minimumAge: 15 },
  exploited_children: { groups: ["workshop", "household", "health"], public: true },
  market_monopoly: { groups: ["market", "records"], public: true, minimumAge: 18 },
  price_gouging: { groups: ["market", "manor"], public: true },
  false_charity: { groups: ["church", "health", "household"], public: false },
  panic_rumor_armed: { groups: ["travel", "market", "watch"], public: true },
  panic_rumor_sickness: { groups: ["travel", "market", "watch", "health"], public: true },
  witchcraft_accusation: { groups: ["health", "church", "household"], public: true },
  missing_person: { groups: ["travel", "watch", "household"], public: true },
  unsafe_bridge: { groups: ["travel", "land", "watch"], public: true },
  contaminated_well: { groups: ["health", "land", "workshop", "household"], public: true },
  midwife_error: { groups: ["health"], public: false, minimumAge: 16 },
  healer_secret: { groups: ["health", "market"], public: false, minimumAge: 16 },
  debt_imprisonment: { groups: ["records", "market", "manor"], public: true, minimumAge: 18 },
  orphan_guardianship: { groups: ["household", "records", "church"], public: true, minimumAge: 18 },
  feast_store_theft: { groups: ["church", "market"], public: false },
  illegal_enclosure: { groups: ["land", "records", "manor"], public: true },
  sanctuary_fugitive: { groups: ["church", "watch", "travel"], public: true }
});

const VARIANTS = [
  {
    opening: "The poor harvest has made everyone quicker to fear another loss.",
    fact: "Poor harvest conditions increase the cost of delay or disruption."
  },
  {
    opening: "If this goes badly, my own household will feel the loss.",
    fact: "{person}'s household bears material risk from the outcome."
  },
  {
    opening: "I promised my family I would not simply look away if this grew worse.",
    fact: "{person} has a private household commitment that increases personal pressure."
  }
];

function occupationPerspective(context, familyId) {
  const occupation = context.occupation || "";
  if (familyId === "contaminated_well") {
    if (["healer", "herbalist", "midwife"].includes(occupation)) return "I noticed the same sickness among people drawing from that water.";
    if (occupation === "tanner") return "I know how tanning runoff moves, and I fear what nearby waste may be doing.";
    if (["farmer", "shepherd", "goatherd"].includes(occupation)) return "The animals and field hands use that water every day.";
    if (occupation === "peddler") return "People along my route spoke of the same symptoms after drinking there.";
    return "Someone in my household uses that well, and the pattern of illness frightened me.";
  }
  if (familyId === "embezzled_grain") {
    if (["miller", "farmer", "merchant", "clerk", "bailiff", "reeve"].includes(occupation)) return "My work put the stores, measures, or records within my reach.";
    return "A delivery, household relation, or duty at the manor gave me access to the reserve.";
  }
  if (["corrupt_tax", "forged_inheritance", "debt_imprisonment", "orphan_guardianship"].includes(familyId)) {
    return ["clerk", "scribe", "reeve", "bailiff"].includes(occupation)
      ? "My work with records showed me where the written terms and the spoken demand no longer matched."
      : "The demand touches my household or someone close enough that I have seen the receipts and consequences.";
  }
  if (["dangerous_apprentice", "exploited_children", "withheld_wages"].includes(familyId)) {
    return ACCESS.workshop.includes(occupation)
      ? "I saw the work, hours, or treatment through my own trade."
      : "A child, worker, or household close to mine told me what was happening.";
  }
  if ((familyId.startsWith("panic_rumor") || ["smuggled_goods", "missing_person"].includes(familyId))
    && ACCESS.travel.includes(occupation)) {
    return "My work carries me along the roads, so I heard or witnessed more than most villagers would.";
  }
  if (ACCESS.market.includes(occupation)) {
    return `I first heard of it from people I deal with through my work as a ${occupation}.`;
  }
  if (ACCESS.workshop.includes(occupation)) {
    return `I noticed it through the workshop and trade work I do as a ${occupation}.`;
  }
  if (ACCESS.land.includes(occupation)) {
    return `I came across it while working the land and roads as a ${occupation}.`;
  }
  if (ACCESS.household.includes(occupation)) {
    return `${context.relation} spoke to me because our households are closely connected.`;
  }
  return `${context.relation} trusted me enough to tell me what had happened.`;
}

const EXPLICIT_DEADLINE_FAMILIES = new Set([
  "coerced_marriage", "forged_inheritance", "withheld_wages", "blackmail_letter",
  "corrupt_tax", "hidden_deserter", "market_monopoly", "debt_imprisonment",
  "orphan_guardianship"
]);

const FAMILY_MECHANISMS = Object.freeze({
  embezzled_grain: "Reserve sacks were removed through work access, and the inventory now points suspicion toward an innocent person.",
  false_accusation: "The accusation rests on reputation and fear rather than the visitor's withheld knowledge of the actual theft.",
  coerced_marriage: "A household is treating marriage consent as collateral for a debt, so refusal threatens shelter and standing.",
  forged_inheritance: "A suspect paper and missing original deed create competing claims that depend on witnesses, marks, and lawful custody of evidence.",
  poaching_for_hunger: "Illegal hunting fed hungry households while physical evidence and arrest shifted punishment toward another person.",
  withheld_wages: "Completed labor remains unpaid because the employer claims immediate payment would collapse the workshop.",
  dangerous_apprentice: "A child's dependence on food, shelter, and training allows unsafe work and violence to continue.",
  hidden_contagion: "Continued shared meals and tools may have spread illness before the visitor disclosed the fever.",
  adulterated_ale: "Weak measure and possible unsafe additives are separate hypotheses requiring market measurement and medical evidence.",
  false_weights: "A short measure transfers small hidden losses from many buyers to the seller and accomplices.",
  boundary_stones: "Moved markers alter land use, rent, and grazing rights while memories and records disagree.",
  blocked_watercourse: "A diverted channel gives one holding more water while starving another field or workshop downstream.",
  smuggled_goods: "Untaxed cloth moved through a hidden route, while official suspicion settled on someone outside the scheme.",
  hidden_fire: "Negligence caused the fire, concealment redirected blame toward construction, and rebuilding costs remain unresolved.",
  household_violence: "Economic and housing dependence make disclosure dangerous because confrontation may trigger immediate retaliation.",
  secret_pregnancy: "A private pregnancy creates competing needs for safety, medical care, consent, shelter, and controlled disclosure.",
  abandoned_elder: "Care duties are disputed among adult children whose claimed poverty may not match their actual stores.",
  stolen_relic: "The relic's sale funded treatment, linking restitution to a confidential illness and a returning buyer.",
  grave_robbery: "The grave was deliberately opened, but the family has not learned the cause and evidence may be disturbed.",
  blackmail_letter: "A private letter can be exchanged for debt relief, but using it would turn knowledge into coercion.",
  bribed_watch: "Payment disabled lawful protection, repeated theft increased resentment, and private revenge may create a second crime.",
  corrupt_tax: "The spoken demand exceeds written assessment, and isolated households lack leverage without shared records.",
  hidden_deserter: "Shelter protects a witness to cruelty but exposes the household to military punishment if discovered.",
  forbidden_courtship: "Mutual consent conflicts with household power, housing dependence, property expectations, and feud risk.",
  exploited_children: "Dangerous hours produce household income, so immediate removal creates a separate food and wage crisis.",
  market_monopoly: "Exclusive rights shift customers and bargaining power from many traders to one holder.",
  price_gouging: "Private reserves and emergency pricing may reflect scarcity, exploitation, or both; stores and purchase records distinguish them.",
  false_charity: "Hidden stores may coexist with vulnerable household members, so fraud and genuine need must be separated.",
  panic_rumor_armed: "Repeated reports of armed travelers are being treated as invasion despite no confirmed banner, number, command, direction, or hostile act.",
  panic_rumor_sickness: "Fear of infected travelers is spreading without a confirmed patient, symptom pattern, exposure place, or healer's examination.",
  witchcraft_accusation: "An unexplained illness and social fear are being converted into blame without witnessed wrongdoing.",
  missing_person: "Absence may reflect voluntary flight, accident, coercion, or violence, and each hypothesis leaves different evidence.",
  unsafe_bridge: "Visible structural damage creates immediate travel risk while repair authority and reimbursement are disputed.",
  contaminated_well: "Matching illness and nearby tanning runoff suggest contamination, but the route and cause remain unproven.",
  midwife_error: "A concealed medical mistake may have contributed to harm, while grief and incomplete records obscure causation.",
  healer_secret: "An ineffective remedy delays other care and consumes scarce money while seller and patient outcomes remain undocumented.",
  debt_imprisonment: "Lawful debt enforcement may be used to seize a workshop rather than secure proportionate repayment.",
  orphan_guardianship: "Care, affection, stability, and control of inherited property are bundled into one guardianship dispute.",
  feast_store_theft: "Missing food may result from theft, key misuse, accounting error, spoilage, or authorized removal not recorded.",
  illegal_enclosure: "A private fence removes customary grazing and fuel access without recorded communal consent.",
  sanctuary_fugitive: "Sanctuary delays surrender while self-defense, injury, witness accounts, and lawful custody remain disputed."
});

const FAMILY_RESPONSE_DOMAINS = Object.freeze({
  embezzled_grain: ["truth", "records", "food_relief", "restitution"],
  false_accusation: ["evidence", "witness_protection", "mediation"],
  coerced_marriage: ["consent", "shelter", "debt", "mediation"],
  forged_inheritance: ["records", "witnesses", "property_law"],
  poaching_for_hunger: ["food_relief", "restitution", "law", "witnesses"],
  withheld_wages: ["contracts", "staged_payment", "workshop_capacity"],
  dangerous_apprentice: ["child_safety", "fostering", "work", "law"],
  hidden_contagion: ["medical", "warning", "isolation", "privacy"],
  adulterated_ale: ["medical", "market_measure", "compensation", "inspection"],
  false_weights: ["market_measure", "restitution", "records"],
  boundary_stones: ["land_records", "witnesses", "mediation"],
  blocked_watercourse: ["water_rights", "inspection", "schedule", "land"],
  smuggled_goods: ["law", "records", "innocent_protection", "restitution"],
  hidden_fire: ["truth", "rebuilding", "inspection", "restitution"],
  household_violence: ["immediate_safety", "shelter", "watch", "care"],
  secret_pregnancy: ["shelter", "medical", "privacy", "consent"],
  abandoned_elder: ["care_schedule", "kin_duties", "charity", "inventory"],
  stolen_relic: ["restitution", "privacy", "medical", "church_property"],
  grave_robbery: ["evidence", "restoration", "family_disclosure", "law"],
  blackmail_letter: ["secrecy", "debt", "mediation", "evidence_custody"],
  bribed_watch: ["watch_reform", "law", "victim_aid", "deescalation"],
  corrupt_tax: ["receipts", "collective_appeal", "manor_authority"],
  hidden_deserter: ["sanctuary", "testimony", "military_law", "household_safety"],
  forbidden_courtship: ["consent", "housing", "mediation", "property"],
  exploited_children: ["child_safety", "wage_replacement", "work_rules", "inspection"],
  market_monopoly: ["market_rules", "rotation", "contracts", "appeal"],
  price_gouging: ["inventory", "price_relief", "market_records", "charity"],
  false_charity: ["inventory", "targeted_aid", "privacy", "accountability"],
  panic_rumor_armed: ["road_intelligence", "watch", "manor_authority", "household_readiness", "public_reassurance"],
  panic_rumor_sickness: ["medical_observation", "traveler_contact", "care_capacity", "separation", "public_reassurance"],
  witchcraft_accusation: ["protection", "medical_investigation", "crowd_control", "law"],
  missing_person: ["search", "road_intelligence", "watch", "privacy"],
  unsafe_bridge: ["closure", "engineering", "labor", "reimbursement"],
  contaminated_well: ["clean_water", "medical_pattern", "runoff_inspection", "authority"],
  midwife_error: ["medical_evidence", "grief_care", "restitution", "professional_accountability"],
  healer_secret: ["patient_outcomes", "remedy_withdrawal", "repayment", "alternative_care"],
  debt_imprisonment: ["partial_payment", "labor_terms", "legal_review", "property_protection"],
  orphan_guardianship: ["care", "property_trust", "consent", "legal_guardianship"],
  feast_store_theft: ["key_audit", "accounts", "replacement_food", "evidence"],
  illegal_enclosure: ["common_rights", "land_records", "fence_removal", "mediation"],
  sanctuary_fugitive: ["sanctuary", "witnesses", "medical_evidence", "lawful_handover"]
});

function eligibleForFamily(context, familyId) {
  if (!context.occupation) return true;
  const rules = FAMILY_ACCESS[familyId] || { groups: [], public: true };
  if (Number.isFinite(rules.minimumAge) && context.age < rules.minimumAge) return false;
  if (rules.groups.some((group) => ACCESS[group]?.includes(context.occupation))) return true;
  if (rules.groups.some((group) => ACCESS[group]?.includes(context.relationOccupation))) return true;
  return Boolean(rules.public);
}

function fill(template, context) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(context[key] ?? key));
}

function spokenOpening(template, context) {
  return fill(
    template
      .replace(/\{person\}'s/g, "My")
      .replace(/\bentrusted \{person\}\b/g, "entrusted me")
      .replace(/\{person\} is\b/g, "I am")
      .replace(/\{person\}\s+/g, "I "),
    context
  );
}

function openingLead(kinds, familyId, variantIndex) {
  const choose = (options) => options[(familyId.length + variantIndex) % options.length];
  if (kinds.includes("confession")) return choose([
    "Forgive me, Father. I have kept something back.",
    "Father, there is something I can no longer carry alone.",
    "I have come to tell you what I did, though I am afraid to say it."
  ]);
  if (kinds.some((kind) => ["family counsel", "private counsel", "decision"].includes(kind))) {
    return choose([
      "Father, I have turned this over until I no longer trust my own judgment.",
      "There is a choice before me, Father, and either answer may hurt someone.",
      "May I ask your judgment on something that has troubled my household?"
    ]);
  }
  if (kinds.some((kind) => ["grave conscience", "faith"].includes(kind))) {
    return choose([
      "Father, my conscience has given me no peace.",
      "I have prayed over this and still do not know what is right.",
      "Something has unsettled my faith, Father."
    ]);
  }
  return choose([
    "Father, people have begun talking, and I do not know how much of it to believe.",
    "I came because something in the village is going wrong.",
    "Father, may I trouble you with something I have seen?"
  ]);
}

export function buildGeneratedScenarioArchetypes(context) {
  return FAMILIES.filter(([id]) => eligibleForFamily(context, id)).flatMap(([id, kinds, premise, harm, alternative]) => (
    VARIANTS.map((variant, index) => {
      const hasExplicitDeadline = EXPLICIT_DEADLINE_FAMILIES.has(id);
      return {
        id: `${id}_${index + 1}`,
        familyId: id,
        kinds,
        deadlineDays: context.deadlineDays,
        hasExplicitDeadline,
        blueprint: {
          pressure: fill(variant.fact, context),
          mechanism: fill(FAMILY_MECHANISMS[id], context),
          peopleInvolved: [context.person, context.relation, context.victim].filter(Boolean),
          sourceChannel: occupationPerspective(context, id),
          responseDomains: FAMILY_RESPONSE_DOMAINS[id] || ["pastoral", "practical"],
          escalationConditions: [
            "Immediate physical danger",
            "Evidence of continuing harm",
            "Refusal by the responsible household or officer",
            "The stated formal deadline, when one exists"
          ]
        },
        opening: `${openingLead(kinds, id, index)} ${spokenOpening(premise, context)} ${spokenOpening(harm, context)} ${spokenOpening(variant.opening, context)} ${occupationPerspective(context, id)}`,
        facts: [
          fill(premise, context),
          fill(FAMILY_MECHANISMS[id], context),
          fill(harm, context),
          fill(alternative, context)
        ],
        factRecords: [
          {
            id: "concrete_matter",
            category: "premise",
            speakable: true,
            text: fill(premise, context)
          },
          {
            id: "mechanism",
            category: "mechanism",
            speakable: true,
            text: fill(FAMILY_MECHANISMS[id], context)
          },
          {
            id: "stakes",
            category: "harm",
            speakable: true,
            text: fill(harm, context)
          },
          {
            id: "source_channel",
            category: "provenance",
            speakable: true,
            text: occupationPerspective(context, id)
          },
          {
            id: "alternative",
            category: "example_response",
            speakable: false,
            text: fill(alternative, context)
          },
          {
            id: "response_domains",
            category: "mechanical",
            speakable: false,
            text: `Plausible response domains include ${(FAMILY_RESPONSE_DOMAINS[id] || ["pastoral", "practical"]).join(", ")}. Other grounded responses remain possible.`
          },
          {
            id: "timeline",
            category: "mechanical",
            speakable: false,
            text: hasExplicitDeadline
              ? `A formal answer is required within ${context.deadlineDays} days.`
              : "No formal deadline is known, though delay may worsen the harm."
          }
        ]
      };
    })
  ));
}

export const GENERATED_SCENARIO_ARCHETYPE_COUNT = FAMILIES.length * VARIANTS.length;
