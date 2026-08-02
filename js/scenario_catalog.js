const FAMILIES = [
  ["embezzled_grain", ["confession", "decision"], "{person} diverted {sum} sacks of grain from the manor reserve.", "{victim} is blamed for the missing grain and may be punished.", "Return the grain, clear the accusation, and request emergency food openly."],
  ["false_accusation", ["confession", "dispute"], "{relation} accused an innocent apprentice of theft.", "{person} knows who actually took the goods but fears retaliation.", "Give the evidence to a neutral witness before confronting the accuser."],
  ["coerced_marriage", ["family counsel", "decision"], "{relation} arranged a marriage to settle a household debt.", "The unwilling bride or groom fears violence and loss of shelter.", "Delay the betrothal and create a separate repayment plan."],
  ["forged_inheritance", ["confession", "dispute"], "A forged inheritance paper gives {relation} control of a cottage and {sum} acres.", "{victim} holds the stronger lawful claim but lacks the document.", "Place both documents with an independent clerk and summon the witnesses."],
  ["poaching_for_hunger", ["confession", "decision"], "{person} poached game from the lord's wood to feed hungry households.", "{victim} has been arrested for the poaching.", "Confess with witnesses and offer restitution in labor or coin."],
  ["withheld_wages", ["dispute", "private counsel"], "{relation} withheld {sum} days of wages after the poor harvest.", "{person}'s household needs the money, but immediate payment may close the workshop.", "Agree to staged repayment secured by written witnesses."],
  ["dangerous_apprentice", ["village concern", "decision"], "An apprentice is being beaten and sent into unsafe night work by {relation}.", "Removing the child also removes food, shelter, and training.", "Arrange temporary fostering and a different apprenticeship."],
  ["hidden_contagion", ["confession", "private counsel"], "{person} concealed a fever and continued sharing meals and tools.", "{relation}'s household may already have been exposed.", "Warn the exposed households and isolate without public shaming."],
  ["adulterated_ale", ["confession", "village concern"], "{relation} is watering ale and adding unsafe herbs to hide the weakness.", "Several laborers are ill, and {victim} is blamed for poor brewing.", "Stop the batch, compensate the sick, and inspect the remaining barrels."],
  ["false_weights", ["confession", "dispute"], "{person} used a short market measure at {relation}'s request.", "The hidden loss falls most heavily on poor buyers.", "Use an honest public measure and repay frequent customers."],
  ["boundary_stones", ["dispute", "decision"], "Someone moved boundary stones near {resource}.", "{relation} gained land while {victim} lost grazing and rent.", "Restore the stones using elderly witnesses who remember the line."],
  ["blocked_watercourse", ["village concern", "dispute"], "{relation} diverted the mill stream toward private land.", "{victim}'s field and workshop now receive too little water.", "Set timed water rights and reopen part of the old channel."],
  ["smuggled_goods", ["confession", "decision"], "{person} helped move untaxed cloth through the village at night.", "{official} suspects {victim}, who had no part in it.", "Reveal the route, repay the duty, and protect the innocent suspect."],
  ["hidden_fire", ["confession", "village concern"], "{person} caused a workshop fire through negligence and concealed the cause.", "{relation} is being charged for faulty construction.", "Admit the neglected flame and help rebuild the damaged shop."],
  ["household_violence", ["family counsel", "grave conscience"], "{victim} is being struck and threatened inside the household.", "Public confrontation may provoke worse violence that night.", "Arrange immediate shelter before confronting the violent person."],
  ["secret_pregnancy", ["confession", "family counsel"], "A young woman entrusted {person} with a hidden pregnancy.", "Her household may respond with violence if the father is named.", "Secure shelter and a midwife before any public disclosure."],
  ["abandoned_elder", ["village concern", "private counsel"], "{victim} has been left without food or firewood by adult children.", "The children claim poverty, but one household has adequate stores.", "Divide care among kin and parish volunteers with a written schedule."],
  ["stolen_relic", ["confession", "faith"], "A church relic was stolen and sold to pay a healer.", "Naming the thief reveals {victim}'s private illness.", "Repurchase the relic first, then resolve restitution privately."],
  ["grave_robbery", ["confession", "grave conscience"], "{relation} opened a recent grave searching for jewelry.", "The dead person's family believes animals disturbed the burial.", "Restore the grave, return the goods, and confess to the family."],
  ["blackmail_letter", ["confession", "decision"], "{person} possesses a letter that could disgrace {relation}.", "Using it would erase a debt but destroy a household's standing.", "Seal the letter with a neutral witness and negotiate without threats."],
  ["bribed_watch", ["village concern", "dispute"], "A watchman accepted coin to ignore night thefts near {resource}.", "{victim} was robbed twice and now plans private revenge.", "Report the bribe to the reeve and compensate victims from seized coin."],
  ["corrupt_tax", ["dispute", "decision"], "{official} demanded more tax than the written assessment.", "Households that cannot pay may lose tools before winter.", "Collect copies of receipts and appeal the excess together."],
  ["hidden_deserter", ["confession", "decision"], "{person} is sheltering a soldier who deserted after witnessing cruelty.", "Discovery may bring punishment on the entire household.", "Seek sanctuary terms and testimony before the patrol returns."],
  ["forbidden_courtship", ["family counsel", "decision"], "{relation} and {victim} are courting against both households' wishes.", "A secret marriage could begin a feud and leave them homeless.", "Use a public delay to test consent and negotiate household terms."],
  ["exploited_children", ["village concern", "decision"], "{relation} employs young children through dangerous winter nights.", "Their wages feed their households, but one child has already been injured.", "Limit the hours and replace the lost wages through parish aid."],
  ["market_monopoly", ["decision", "dispute"], "{relation} seeks exclusive rights to sell at the village market.", "{victim} and several small traders would lose all customers.", "Grant rotating stalls or limit exclusivity to one season."],
  ["price_gouging", ["village concern", "decision"], "{relation} doubled grain prices while keeping a private reserve.", "Hungry households are selling tools to buy food.", "Publish the reserve, cap emergency prices, and repay later through fair trade."],
  ["false_charity", ["confession", "village concern"], "A household receives church food while hiding full grain bins.", "The deception is draining aid from families in true need.", "Limit aid to vulnerable members and require an honest inventory."],
  ["panic_rumor", ["ordinary talk", "village concern"], "A rumor says soldiers or plague are approaching {town}.", "Families are hoarding food and preparing to flee without evidence.", "Send trusted witnesses to verify the road before public reassurance."],
  ["witchcraft_accusation", ["village concern", "grave conscience"], "{victim} is accused of witchcraft after a child's unexplained illness.", "Fear is becoming a mob, though no witness saw wrongdoing.", "Protect the accused, investigate the illness, and forbid vigilante punishment."],
  ["missing_person", ["village concern", "family counsel"], "{relation} vanished after traveling near {resource}.", "One household suspects flight from debt; another fears violence.", "Organize a search while keeping unproven accusations private."],
  ["unsafe_bridge", ["village concern", "decision"], "The bridge near {resource} is close to collapse.", "{official} refuses repair until after tax collection.", "Close the bridge, organize labor, and seek written reimbursement."],
  ["contaminated_well", ["village concern", "private counsel"], "Several households became ill after drawing from the common well.", "{relation} dumped tanning waste nearby but denies responsibility.", "Close the well, secure clean water, and inspect the runoff."],
  ["midwife_error", ["confession", "grave conscience"], "A birth went badly, and the midwife concealed a serious mistake.", "The grieving family blames divine punishment instead of negligence.", "Tell the medical truth carefully and arrange restitution and care."],
  ["healer_secret", ["confession", "faith"], "A healer knows a popular remedy is ineffective but continues selling it.", "Desperate families spend scarce coin while real treatment is delayed.", "Withdraw the remedy publicly and repay the poorest patients."],
  ["debt_imprisonment", ["decision", "village concern"], "{victim} may be imprisoned over a debt of {sum} silver pennies.", "The creditor is lawful but using imprisonment to seize the workshop.", "Raise part of the debt and negotiate labor for the remainder."],
  ["orphan_guardianship", ["family counsel", "decision"], "Two households claim guardianship of an orphan with a small inheritance.", "One offers affection; the other offers stability but expects control of the property.", "Separate guardianship from management of the inheritance."],
  ["feast_store_theft", ["confession", "village concern"], "Food reserved for a holy-day feast has disappeared.", "{victim} is blamed because of an old reputation for theft.", "Audit the storehouse keys and replace the food before accusing anyone."],
  ["illegal_enclosure", ["dispute", "village concern"], "{relation} fenced part of the common field without consent.", "Poor households can no longer graze goats or gather fuel.", "Remove part of the fence and negotiate a limited private allotment."],
  ["sanctuary_fugitive", ["faith", "decision"], "A fugitive has claimed sanctuary in the church after injuring a watchman.", "The watch demands surrender, while the fugitive claims self-defense.", "Hear witnesses under sanctuary before negotiating a lawful handover."]
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
  panic_rumor: { groups: ["travel", "market", "watch"], public: true },
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
    opening: "The poor harvest and the hunger around us make the choice harder.",
    fact: "Hunger after the poor harvest is adding pressure to the decision."
  },
  {
    opening: "My household depends upon the outcome, so I cannot treat this as someone else's trouble.",
    fact: "{person}'s household has a direct practical stake in the outcome."
  },
  {
    opening: "A private promise I made to my family complicates the honest course.",
    fact: "{person} made a private promise to protect the household from this loss."
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
  if (["panic_rumor", "smuggled_goods", "missing_person"].includes(familyId) && ACCESS.travel.includes(occupation)) {
    return "My work carries me along the roads, so I heard or witnessed more than most villagers would.";
  }
  return "The matter reached me through my household, work, travel, or a person I know well.";
}

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

function openingLead(kinds) {
  if (kinds.includes("confession")) return "Father, I need to speak plainly.";
  if (kinds.some((kind) => ["family counsel", "private counsel", "decision"].includes(kind))) {
    return "Father, I need your counsel.";
  }
  if (kinds.some((kind) => ["grave conscience", "faith"].includes(kind))) {
    return "Father, this matter weighs on my conscience.";
  }
  return "Father, I have come about a trouble in the village.";
}

export function buildGeneratedScenarioArchetypes(context) {
  return FAMILIES.filter(([id]) => eligibleForFamily(context, id)).flatMap(([id, kinds, premise, harm, alternative]) => (
    VARIANTS.map((variant, index) => ({
      id: `${id}_${index + 1}`,
      familyId: id,
      kinds,
      opening: `${openingLead(kinds)} ${spokenOpening(premise, context)} ${spokenOpening(harm, context)} ${spokenOpening(variant.opening, context)} ${occupationPerspective(context, id)}`,
      facts: [
        fill(premise, context),
        fill(harm, context),
        `${fill(variant.fact, context)} ${occupationPerspective(context, id)} A decision is expected within ${context.deadlineDays} days.`,
        fill(alternative, context)
      ]
    }))
  ));
}

export const GENERATED_SCENARIO_ARCHETYPE_COUNT = FAMILIES.length * VARIANTS.length;
