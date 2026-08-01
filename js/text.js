function normalizeGeneratedText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[^\u0020-\u024f\u2013-\u201f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function completeGeneratedText(value, maximum) {
  const text = normalizeGeneratedText(value);
  if (!Number.isInteger(maximum) || maximum < 1) return text;
  if (text.length <= maximum) {
    if (!/\b(?:and|or|but|to|with|from|because|that|the|a|an)$/i.test(text)) return text;
    const sentenceBreak = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
    if (sentenceBreak >= Math.floor(text.length * 0.3)) return text.slice(0, sentenceBreak + 1).trim();
    return `${text.replace(/\s+\S+$/, "").trim()}...`;
  }
  const clipped = text.slice(0, maximum).trimEnd();
  const sentenceBreak = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!"),
    clipped.lastIndexOf("?")
  );
  if (sentenceBreak >= Math.floor(maximum * 0.45)) {
    return clipped.slice(0, sentenceBreak + 1).trim();
  }
  const wordBreak = clipped.lastIndexOf(" ");
  return `${(wordBreak >= Math.floor(maximum * 0.55) ? clipped.slice(0, wordBreak) : clipped).trim()}...`;
}

export function completeStoredText(value, maximum) {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!Number.isInteger(maximum) || maximum < 1) return text;
  if (text.length <= maximum) {
    if (!/\b(?:and|or|but|to|with|from|because|that|the|a|an)$/i.test(text)) return text;
    const sentenceBreak = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
    if (sentenceBreak >= Math.floor(text.length * 0.3)) return text.slice(0, sentenceBreak + 1).trim();
    return `${text.replace(/\s+\S+$/, "").trim()}...`;
  }
  const clipped = text.slice(0, maximum).trimEnd();
  const sentenceBreak = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!"),
    clipped.lastIndexOf("?")
  );
  if (sentenceBreak >= Math.floor(maximum * 0.45)) {
    return clipped.slice(0, sentenceBreak + 1).trim();
  }
  const wordBreak = clipped.lastIndexOf(" ");
  return `${(wordBreak >= Math.floor(maximum * 0.55) ? clipped.slice(0, wordBreak) : clipped).trim()}...`;
}
