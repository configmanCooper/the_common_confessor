/* Turn one watched playthrough into a readable account of that priest.
 *
 * Everything here is derived from the run's own record: what he said, what he
 * chose, what he gave away, and what measurably changed in the parish because
 * of it. Nothing is invented — where the data does not support a claim the
 * document says so.
 *
 *   node scripts/playthrough-report.mjs exports/run1-benevolent.log.json
 *   node scripts/playthrough-report.mjs --all
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const exportsDir = join(root, "exports");

const FONT = "Palatino Linotype";

function body(text, options = {}) {
  return new Paragraph({
    spacing: { after: 140, line: 300 },
    alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({ text: String(text), font: FONT, size: 22, italics: Boolean(options.italics) })]
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text: String(text), font: FONT, bold: true, size: level === HeadingLevel.TITLE ? 40 : 28 })]
  });
}

function quote(speaker, text) {
  return new Paragraph({
    spacing: { after: 100, line: 280 },
    indent: { left: 480 },
    children: [
      new TextRun({ text: `${speaker}: `, font: FONT, size: 20, bold: true }),
      new TextRun({ text: String(text), font: FONT, size: 20, italics: true })
    ]
  });
}

function cell(text, bold = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text), font: FONT, size: 20, bold })] })]
  });
}

function table(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((header) => cell(header, true)) }),
      ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) }))
    ]
  });
}

function pct(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

function analyse(data) {
  const visits = data.log.filter((entry) => entry.kind === "visit");
  const sermons = data.log.filter((entry) => entry.kind === "sermon");
  const exchanges = visits.flatMap((visit) => (visit.exchanges || [])
    .filter((entry) => entry.visitor)
    .map((entry) => ({ ...entry, to: visit.visitor })));
  const priestLines = exchanges.map((entry) => entry.priest);
  const first = data.snapshots?.[0];
  const last = data.snapshots?.[data.snapshots.length - 1];

  const words = priestLines.map((line) => line.split(/\s+/).length).sort((a, b) => a - b);
  const questions = priestLines.filter((line) => line.includes("?")).length;
  const commands = priestLines.filter((line) => /^(?:go|tell|bring|send|take|do not|say|keep|speak|make|come)\b/i.test(line.trim())).length;
  const comfort = priestLines.filter((line) => /\b(?:god|mercy|pray|forgive|grace|blessing|peace|comfort)\b/i.test(line)).length;
  const gifts = exchanges.flatMap((entry) => (
    (entry.churchGifts?.length ? entry.churchGifts : [entry.churchGift].filter(Boolean))
      .map((gift) => ({ ...gift, to: entry.to }))
  ));

  const storeDelta = {};
  if (first && last) {
    for (const key of Object.keys(first.churchStores || {})) {
      const change = (last.churchStores[key] ?? 0) - (first.churchStores[key] ?? 0);
      if (change !== 0) storeDelta[key] = change;
    }
  }

  const tracked = data.trackedPeople || [];
  const changedFields = (person) => ["stress", "health", "faith", "trustPriest", "memories", "relationships", "wealth", "food"]
    .filter((field) => typeof person.start?.[field] === "number"
      && typeof person.end?.[field] === "number"
      && person.start[field] !== person.end[field]);

  return {
    visits,
    sermons,
    exchanges,
    first,
    last,
    style: {
      lines: priestLines.length,
      medianWords: words[Math.floor(words.length / 2)] || 0,
      longest: words[words.length - 1] || 0,
      questions,
      commands,
      comfort
    },
    gifts,
    storeDelta,
    tracked: tracked.map((person) => ({ ...person, changed: changedFields(person) }))
  };
}

function buildDocument(data) {
  const a = analyse(data);
  const personaName = data.persona?.name || "An unnamed priest";
  const children = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: personaName, font: FONT, bold: true, size: 44 })]
    }),
    body(`A week and a day in ${a.first?.town ? "the parish" : "the parish"}, played by ${data.model}`, { center: true, italics: true }),
    body(`Seed ${data.seed} · ${data.daysPlayed} days · ${a.visits.length} appointments · ${a.exchanges.length} exchanges`, { center: true, italics: true })
  );

  /* ---------------------------------------------------------- his manner */
  children.push(heading("His manner"));
  if (data.persona?.id) {
    children.push(body(`He was set to play as follows, and the record below is what that produced in practice.`));
  }
  const s = a.style;
  children.push(body(
    `Across ${s.lines} spoken turns he averaged ${s.medianWords} words, his longest reaching ${s.longest}. `
    + `${pct(s.questions, s.lines)} of what he said was a question, `
    + `${pct(s.commands, s.lines)} was an instruction, and `
    + `${pct(s.comfort, s.lines)} invoked God, mercy, prayer or forgiveness directly.`
  ));
  const leaning = s.questions > s.commands
    ? "He asked more than he directed: a priest who wanted to know before he judged."
    : s.commands > s.questions * 1.5
      ? "He directed far more than he asked, telling people what to do rather than drawing them out."
      : "He balanced asking and instructing fairly evenly.";
  children.push(body(leaning));

  const opening = a.exchanges[0];
  if (opening) {
    children.push(body("His first words in the parish were these:"));
    children.push(quote("Priest", opening.priest));
    children.push(quote("The visitor", opening.visitor));
  }

  /* -------------------------------------------------------- what he gave */
  children.push(heading("What he gave, and what it cost"));
  if (!a.gifts.length) {
    children.push(body(
      "He gave nothing at all from the church stores across the whole period. "
      + "Either the need never presented itself in a form he recognised, or charity was not his instinct."
    ));
  } else {
    const total = a.gifts.reduce((sum, gift) => sum + gift.amount, 0);
    children.push(body(
      `He gave ${a.gifts.length} times, ${total} units in all, across ${new Set(a.gifts.map((gift) => gift.resource)).size} different kinds of need.`
    ));
    children.push(table(
      ["Given to", "What", "How much"],
      a.gifts.slice(0, 16).map((gift) => [
        gift.to || "—",
        gift.label || gift.resource,
        String(gift.amount)
      ])
    ));
  }
  if (Object.keys(a.storeDelta).length) {
    children.push(body("The stores stood differently at the end than at the beginning:"));
    children.push(table(
      ["Store", "At the start", "At the end", "Change"],
      Object.entries(a.storeDelta).map(([key, change]) => [
        key,
        String(a.first.churchStores[key]),
        String(a.last.churchStores[key]),
        change > 0 ? `+${change}` : String(change)
      ])
    ));
  } else {
    children.push(body("Not one of the church stores moved across the entire period."));
  }

  /* ------------------------------------------------------- his preaching */
  children.push(heading("His preaching"));
  if (!a.sermons.length) {
    children.push(body("No Sunday fell within this run, so the parish never heard him preach."));
  } else {
    for (const sermon of a.sermons) {
      children.push(body(`Week ${sermon.week}, on ${sermon.theme}:`, { italics: true }));
      children.push(quote("From the pulpit", sermon.text));
      if (sermon.reason) children.push(body(`He chose it because: ${sermon.reason}`, { italics: true }));
    }
  }

  /* ------------------------------------------------ who came, and what for */
  children.push(heading("Who came to him"));
  const issues = {};
  for (const visit of a.visits) issues[visit.issue] = (issues[visit.issue] || 0) + 1;
  children.push(table(
    ["Matter brought", "Times"],
    Object.entries(issues).sort((x, y) => y[1] - x[1]).map(([issue, count]) => [issue, String(count)])
  ));
  children.push(table(
    ["Day", "Visitor", "Trade", "Matter", "Turns"],
    a.visits.map((visit) => [
      String(visit.day),
      visit.visitor || "—",
      visit.occupation || "—",
      visit.issue || "—",
      String((visit.exchanges || []).length)
    ])
  ));

  /* ------------------------------------------- how the village was changed */
  children.push(heading("How the village was changed"));
  if (a.first && a.last) {
    const rows = [];
    const push = (label, from, to) => {
      if (typeof from !== "number" || typeof to !== "number" || from === to) return;
      rows.push([label, String(from), String(to), (to - from > 0 ? "+" : "") + Number((to - from).toFixed(2))]);
    };
    for (const key of Object.keys(a.first.town || {})) push(`Parish ${key}`, a.first.town[key], a.last.town[key]);
    for (const key of Object.keys(a.first.priest || {})) push(`Priest ${key}`, a.first.priest[key], a.last.priest[key]);
    for (const key of Object.keys(a.first.population || {})) push(key, a.first.population[key], a.last.population[key]);
    for (const key of Object.keys(a.first.counts || {})) push(key, a.first.counts[key], a.last.counts[key]);
    if (rows.length) {
      children.push(body("Every measure that moved between the first day and the last:"));
      children.push(table(["Measure", "Start", "End", "Change"], rows));
    } else {
      children.push(body("Nothing measurable about the parish changed, which is itself worth noting."));
    }
  }

  /* --------------------------------------------------- the people themselves */
  children.push(heading("The people themselves"));
  const visitors = a.tracked.filter((person) => person.why === "visited the priest");
  const others = a.tracked.filter((person) => person.why !== "visited the priest");
  const movedVisitors = visitors.filter((person) => person.changed.length);
  children.push(body(
    `Of the ${visitors.length} people who sat down with him, ${movedVisitors.length} were measurably different afterwards. `
    + (others.length
      ? `${others.filter((person) => person.changed.length).length} of the ${others.length} third parties named in those conversations were also affected.`
      : "No third parties were tracked in this run.")
  ));
  if (a.tracked.length) {
    children.push(table(
      ["Person", "How they came into it", "What changed in them"],
      a.tracked.slice(0, 20).map((person) => [
        person.name,
        person.why,
        person.changed.length ? person.changed.join(", ") : "nothing"
      ])
    ));
  }

  /* ------------------------------------------------------------- a verdict */
  children.push(heading("What kind of priest this was"));
  const verdict = [];
  verdict.push(a.gifts.length
    ? `He was willing to spend the parish's own substance on the people in front of him, ${a.gifts.length} times over ${data.daysPlayed} days.`
    : "He never once opened the church stores, whatever was asked of him.");
  verdict.push(s.questions > s.commands
    ? "He preferred to ask, and generally established the facts before pronouncing on them."
    : "He preferred to instruct, and often told a visitor what to do before the matter was fully out.");
  verdict.push(movedVisitors.length === visitors.length && visitors.length
    ? "Everyone who came to him left changed in some measurable way."
    : `${visitors.length - movedVisitors.length} of those who came to him left exactly as they arrived.`);
  for (const line of verdict) children.push(body(line));

  return new Document({
    creator: "The Common Confessor",
    title: `${personaName} — a watched playthrough`,
    sections: [{ children }]
  });
}

async function reportFor(logFile) {
  const data = JSON.parse(readFileSync(logFile, "utf8"));
  const doc = buildDocument(data);
  const out = logFile.replace(/\.log\.json$/, ".analysis.docx");
  writeFileSync(out, await Packer.toBuffer(doc));
  console.log(`wrote ${out}`);
  return out;
}

const argument = process.argv[2];
if (argument === "--all" || !argument) {
  const files = readdirSync(exportsDir).filter((name) => name.endsWith(".log.json"));
  if (!files.length) {
    console.error("no playthrough logs in exports/");
    process.exit(1);
  }
  for (const file of files) await reportFor(join(exportsDir, file));
} else {
  await reportFor(argument);
}
