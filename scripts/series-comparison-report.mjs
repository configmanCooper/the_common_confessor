/*
 * A comparison across the whole persona series.
 *
 * The individual reports say what happened in one parish. This one asks the
 * question the series was actually run to answer: does the kind of priest you
 * are change the village, and in which direction?
 *
 *   node scripts/series-comparison-report.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { createGame } from "../js/simulation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "exports");

const PERSONA_NAMES = {
  "run2-austere": "The severe reformer",
  "run3-political": "The careful politician",
  "run4-timid": "The hesitant shepherd",
  "run5-pragmatic": "The practical steward",
  "run6-zealous": "The zealot",
  "run7-benevolent": "The good shepherd"
};

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 260, after: 130 } });
}

function body(text) {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 110 } });
}

function cell(text, bold = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold })] })]
  });
}

function table(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((h) => cell(h, true)) }),
      ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) }))
    ]
  });
}

const rows = JSON.parse(readFileSync(join(OUT_DIR, "series-comparison.json"), "utf8"));
for (const row of rows) {
  const base = createGame(`crowmarsh-${row.name}`);
  row.start = {
    harmony: Math.round(base.town.metrics.harmony),
    faith: Math.round(base.town.metrics.faith),
    mercy: Math.round(base.town.metrics.mercy),
    safety: Math.round(base.town.metrics.safety)
  };
  row.persona = PERSONA_NAMES[row.name] || row.name;
  row.label = row.name.replace(/^run\d+-/, "");
}

const byOffering = [...rows].sort((a, b) => b.offer - a.offer);
const byReach = [...rows].sort((a, b) => (b.moved / b.attend) - (a.moved / a.attend));
const byChange = [...rows].sort((a, b) => (
  (Number(b.deltas.safety) + Number(b.deltas.faith) + Number(b.deltas.mercy))
  - (Number(a.deltas.safety) + Number(a.deltas.faith) + Number(a.deltas.mercy))
));

const document = new Document({
  sections: [{
    children: [
      new Paragraph({ text: "Six priests, six parishes", heading: HeadingLevel.TITLE }),
      body(
        "Each of these runs put a differently-tempered priest into a fresh village of two hundred souls for "
        + "eight days, four visitors a day, one Sunday sermon. The model played the priest; the villagers were "
        + "voiced separately; the simulation owned every consequence. The question is whether the kind of man "
        + "he is shows up in the village he leaves behind."
      ),
      body(
        "A caution before the numbers. Each parish starts from its own seed, so the figures below are changes "
        + "over the eight days rather than final scores, and the runs were not all made against identical code: "
        + "faults found in the early runs were fixed as the series went on, which is set out at the end."
      ),

      heading("What each priest did"),
      table(
        ["Priest", "Visits", "Things said", "Gifts", "Summonses", "Petitions", "Sent for"],
        rows.map((r) => [r.persona, r.visits, r.turns, r.gifts, r.summons, r.petitions, r.requests])
      ),
      body(
        "The clearest division in the series is not warmth against severity but intervention against restraint. "
        + `The severe reformer sent for the watch ${rows.find((r) => r.label === "austere").summons} times in eight days; `
        + `the good shepherd, ${rows.find((r) => r.label === "benevolent").summons}. `
        + "One governed his parish through the law, the other almost entirely through counsel."
      ),

      heading("The Sunday"),
      table(
        ["Priest", "Theme", "Offering", "Households giving", "Souls moved", "Attendance", "Spent at market"],
        rows.map((r) => [r.persona, r.theme, `${r.offer}d`, r.givers, r.moved, r.attend, `${r.market}d`])
      ),
      body(
        `Money follows warmth almost exactly: ${byOffering.map((r) => `${r.label} ${r.offer}d`).join(", ")}. `
        + "The good shepherd was given twenty-four times what the hesitant one was given, from a congregation "
        + "of almost identical size."
      ),
      body(
        "Persuasion does not follow money. "
        + `Ranked by the share of the congregation a sermon actually moved: ${byReach.map((r) => `${r.label} ${Math.round(r.moved / r.attend * 100)}%`).join(", ")}. `
        + "The practical steward moved two thirds of his parish while collecting less than half what the good "
        + "shepherd collected, and the zealot — preaching repentance, and the most frightening of the six — "
        + "moved the fewest of anyone."
      ),

      heading("What became of the village"),
      table(
        ["Priest", "Harmony", "Faith", "Mercy", "Prosperity", "Safety", "Trust in him", "His authority"],
        rows.map((r) => [
          r.persona, r.deltas.harmony, r.deltas.faith, r.deltas.mercy,
          r.deltas.prosperity, r.deltas.safety, r.deltas.trust, r.deltas.authority
        ])
      ),
      body(
        `Ranked by how much the parish moved at all: ${byChange.map((r) => r.label).join(", then ")}. `
        + "The two priests who used the machinery of the village hardest — the reformer and the zealot — left "
        + "the largest mark on it, and the gentlest priest left the smallest. He raised the most money and was "
        + "liked, and the village was very nearly where he found it."
      ),
      body(
        "The finding worth sitting with is that mercy, of all the figures, rose most under the two hardest men. "
        + "It is not a measure of how kindly the priest speaks; it is the parish's belief that it will be caught "
        + "when it falls, and that belief is built by the church visibly acting — opening its stores, sending the "
        + "watch, settling matters — rather than by sympathy in a private room."
      ),

      heading("Where the parish was left"),
      table(
        ["Priest", "Church coin", "Scandal", "Dead", "Sick", "Injured"],
        rows.map((r) => [r.persona, `${r.coin}d`, r.scandal, r.dead, r.ill, r.injured])
      ),
      body(
        "Nobody died in any of the six parishes in eight days, which is as it should be: the mortality built into "
        + "this village is meant to need weeks of neglect, not a bad afternoon. The one priest to accumulate real "
        + "scandal was the hesitant one, which is a fair verdict on hesitancy — he was not accused of anything he "
        + "did, but of the things he would not do."
      ),

      heading("How much of this is trustworthy"),
      body(
        "The series was also a hunt for faults, and it found several. They were fixed as they appeared, which "
        + "means the later runs were played against better code than the earlier ones. The most consequential:"
      ),
      body(
        "The severe reformer was recorded making twenty-three gifts. He gives nothing away. The check for whether "
        + "the priest had handed something over asked only whether a giving-ish word and a pantry word both "
        + "appeared in the sentence, so interrogating a man about missing flour opened the stores. Seventeen of "
        + "his twenty-three gifts were phantoms, and each one also raised the parish's mercy, so his +20 mercy is "
        + "the least trustworthy figure in this document."
      ),
      body(
        "By the last two runs the same check refused every spurious gift while still passing every real one: the "
        + "zealot made eighteen gifts and the good shepherd ten, and not one of them was unaccounted for."
      ),
      table(
        ["Priest", "Gifts recorded", "Gifts the priest never mentioned"],
        rows.map((r) => [r.persona, r.gifts, `${r.unjust} (${r.gifts ? Math.round(r.unjust / r.gifts * 100) : 0}%)`])
      ),
      body(
        "The other faults found and fixed mid-series: the watch being sent on the same errand up to seven times "
        + "in one conversation; villagers inventing families that did not exist in the parish; and the transcript "
        + "showing the model's raw words rather than the cleaned ones the village actually heard."
      ),
      body(
        "One caveat on the final run: the good shepherd's parish was stopped after its seventh day rather than "
        + "its eighth, so his village had one day less than the others to change."
      )
    ]
  }]
});

mkdirSync(OUT_DIR, { recursive: true });
const path = join(OUT_DIR, "series-comparison.docx");
writeFileSync(path, await Packer.toBuffer(document));
console.log(`wrote ${path}`);
