const measurementAliases = [
  { field: "Skirt / trouser length", aliases: ["skirt length", "trouser length", "trousers length", "pant length", "pants length"] },
  { field: "Blouse length", aliases: ["blouse length", "blouse len", "top length"] },
  { field: "Under bust", aliases: ["under bust", "underbust"] },
  { field: "Waist to hip", aliases: ["waist to hip", "waist hip"] },
  { field: "Waist to floor", aliases: ["waist to floor"] },
  { field: "Back length", aliases: ["back length", "back len"] },
  { field: "Front length", aliases: ["front length", "front len"] },
  { field: "Full length", aliases: ["full length", "full len"] },
  { field: "Hip depth", aliases: ["hip depth"] },
  { field: "Inseam", aliases: ["inseam", "inside leg"] },
  { field: "Armhole", aliases: ["armhole", "arm hole"] },
  { field: "Shoulder", aliases: ["shoulder", "shoulders"] },
  { field: "Sleeve", aliases: ["sleeve", "sleeve length"] },
  { field: "Bicep", aliases: ["bicep", "upper arm"] },
  { field: "Wrist", aliases: ["wrist"] },
  { field: "Cuff", aliases: ["cuff", "cuff width"] },
  { field: "Thigh", aliases: ["thigh"] },
  { field: "Chest", aliases: ["chest", "bust"] },
  { field: "Waist", aliases: ["waist"] },
  { field: "Hips", aliases: ["hips", "hip"] },
  { field: "Neck", aliases: ["neck"] },
  { field: "Knee", aliases: ["knee"] },
  { field: "Ankle", aliases: ["ankle"] },
  { field: "Rise", aliases: ["rise"] },
];

const numberPattern = String.raw`(\d{1,3}(?:[.,]\d{1,2})?(?:\s+\d\s*\/\s*\d)?)`;

function normalizeMeasurement(value) {
  const cleaned = value.replace(",", ".");
  const fraction = cleaned.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return String(Number((Number(fraction[1]) + Number(fraction[2]) / Number(fraction[3])).toFixed(2)));
  return String(Number(cleaned));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractMeasurements(text) {
  const measurements = {};
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[“”"]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);

  for (const line of lines) {
    const normalizedLine = line.toLowerCase();
    for (const { field, aliases } of measurementAliases) {
      if (measurements[field]) continue;
      const aliasPattern = aliases.map(escapeRegex).sort((a, b) => b.length - a.length).join("|");
      const labelFirst = new RegExp(`(?:^|\\b)(?:${aliasPattern})(?:\\b|\\s*[:=\\-])\\s*[:=\\-]?\\s*${numberPattern}`, "i").exec(normalizedLine);
      const numberFirst = new RegExp(`${numberPattern}\\s*(?:in(?:ches?)?\\s*)?(?:${aliasPattern})\\b`, "i").exec(normalizedLine);
      const match = labelFirst?.[1] || numberFirst?.[1];
      if (match) measurements[field] = normalizeMeasurement(match);
    }
  }
  return measurements;
}
