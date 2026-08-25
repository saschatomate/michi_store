import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function zoom(src: string, name: string) {
  const img = sharp(`${DIR}/${src}.png`);
  const meta = await img.metadata();
  const w = meta.width!, h = meta.height!;
  const buf = await img.resize(Math.round(w*0.7), Math.round(h*0.7)).png().toBuffer();
  const scale = 0.7;
  const lines: string[] = [];
  const step = 50;
  for (let x = 0; x <= w; x += step) {
    const sx = x * scale;
    lines.push(`<line x1="${sx}" y1="0" x2="${sx}" y2="${h*scale}" stroke="rgba(255,0,0,0.5)" stroke-width="1" />`);
    if (x % 100 === 0) lines.push(`<text x="${sx+2}" y="14" font-size="12" fill="red">${x}</text>`);
  }
  for (let y = 0; y <= h; y += step) {
    const sy = y * scale;
    lines.push(`<line x1="0" y1="${sy}" x2="${w*scale}" y2="${sy}" stroke="rgba(0,0,255,0.5)" stroke-width="1" />`);
    if (y % 100 === 0) lines.push(`<text x="2" y="${sy+12}" font-size="12" fill="blue">${y}</text>`);
  }
  const svg = `<svg width="${w*scale}" height="${h*scale}" xmlns="http://www.w3.org/2000/svg">${lines.join("")}</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/locate-${name}.png`);
}

async function main() {
  const models = ["sophia", "claire", "jen", "amara"];
  const poses = ["frontal", "dreiviertelprofil", "seitlich"];
  const jobs: Promise<void>[] = [];
  for (const m of models) {
    for (const p of poses) {
      jobs.push(zoom(`newbase-${m}-${p}-ring`, `${m}-${p}-ring`));
    }
  }
  await Promise.all(jobs);
  console.log("done");
}
main();
