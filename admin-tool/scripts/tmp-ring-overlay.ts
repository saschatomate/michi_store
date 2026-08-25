import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

// Re-render the same full-hand crops as recheck3, but with a candidate crosshair burned in,
// so grid + hand + candidate are all visible together for direct comparison.
async function zoomWithMark(src: string, name: string, cx: number, cy: number, halfW: number, halfH: number, step: number, scale: number, markX: number, markY: number) {
  const left = Math.max(0, cx - halfW);
  const top = Math.max(0, cy - halfH);
  const width = halfW * 2;
  const height = halfH * 2;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(Math.round(width * scale), Math.round(height * scale), { kernel: "nearest" }).png().toBuffer();
  const lines: string[] = [];
  for (let x = 0; x <= width; x += step) {
    const sx = x * scale;
    lines.push(`<line x1="${sx}" y1="0" x2="${sx}" y2="${height*scale}" stroke="rgba(255,0,0,0.35)" stroke-width="1"/>`);
    lines.push(`<text x="${sx+2}" y="14" font-size="12" fill="red">${left+x}</text>`);
  }
  for (let y = 0; y <= height; y += step) {
    const sy = y * scale;
    lines.push(`<line x1="0" y1="${sy}" x2="${width*scale}" y2="${sy}" stroke="rgba(0,0,255,0.35)" stroke-width="1"/>`);
    lines.push(`<text x="2" y="${sy+12}" font-size="12" fill="blue">${top+y}</text>`);
  }
  const mx = (markX - left) * scale;
  const my = (markY - top) * scale;
  lines.push(`<line x1="${mx-30}" y1="${my}" x2="${mx+30}" y2="${my}" stroke="lime" stroke-width="2"/>`);
  lines.push(`<line x1="${mx}" y1="${my-30}" x2="${mx}" y2="${my+30}" stroke="lime" stroke-width="2"/>`);
  lines.push(`<circle cx="${mx}" cy="${my}" r="8" fill="none" stroke="magenta" stroke-width="3"/>`);
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">${lines.join("")}</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/overlay-${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number, number, number, number, number, number][] = [
    // src, name, cx, cy, halfW, halfH, step, scale, markX, markY
    ["newbase-sophia-seitlich-ring", "sophia-seitlich-ring", 500, 480, 280, 280, 30, 1.6, 590, 378],
    ["newbase-jen-dreiviertelprofil-ring", "jen-dvp-ring", 620, 850, 320, 400, 40, 1.4, 681, 592],
    ["newbase-jen-seitlich-ring", "jen-seitlich-ring", 600, 650, 280, 280, 30, 1.6, 586, 566],
    ["newbase-amara-seitlich-ring", "amara-seitlich-ring", 600, 750, 280, 280, 30, 1.6, 484, 636],
  ];
  await Promise.all(targets.map(([src, name, cx, cy, halfW, halfH, step, scale, mx, my]) => zoomWithMark(src, name, cx, cy, halfW, halfH, step, scale, mx, my)));
  console.log("done");
}
main();
