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
  ["panic_rumor", ["ordinary talk", "village concern"], "A rumor says soldiers or plague are approaching Alderwick.", "Families are hoarding food and preparing to flee without evidence.", "Send trusted witnesses to verify the road before public reassurance."],
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

const VARIANTS = [
  "The poor harvest and the hunger around us make the choice harder.",
  "My household debt makes the profitable choice difficult to refuse.",
  "A private promise I made to my family complicates the honest course."
];

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
  return FAMILIES.flatMap(([id, kinds, premise, harm, alternative]) => (
    VARIANTS.map((motive, index) => ({
      id: `${id}_${index + 1}`,
      kinds,
      opening: `${openingLead(kinds)} ${spokenOpening(premise, context)} ${spokenOpening(harm, context)} ${motive}`,
      facts: [
        fill(premise, context),
        fill(harm, context),
        `${motive} A decision is expected within ${context.deadlineDays} days.`,
        fill(alternative, context)
      ]
    }))
  ));
}

export const GENERATED_SCENARIO_ARCHETYPE_COUNT = FAMILIES.length * VARIANTS.length;
