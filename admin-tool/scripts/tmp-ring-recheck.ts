import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function zoom(src: string, name: string, cx: number, cy: number, half: number) {
  const left = Math.max(0, cx - half);
  const top = Math.max(0, cy - half);
  const width = half * 2;
  const height = half * 2;
  const scale = 1.8;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(Math.round(width * scale), Math.round(height * scale), { kernel: "nearest" }).png().toBuffer();
  const lines: string[] = [];
  const step = 50;
  for (let x = 0; x <= width; x += step) {
    const sx = x * scale;
    lines.push(`<line x1="${sx}" y1="0" x2="${sx}" y2="${height*scale}" stroke="rgba(255,0,0,0.5)" stroke-width="1"/>`);
    lines.push(`<text x="${sx+2}" y="14" font-size="13" fill="red">${left+x}</text>`);
  }
  for (let y = 0; y <= height; y += step) {
    const sy = y * scale;
    lines.push(`<line x1="0" y1="${sy}" x2="${width*scale}" y2="${sy}" stroke="rgba(0,0,255,0.5)" stroke-width="1"/>`);
    lines.push(`<text x="2" y="${sy+12}" font-size="13" fill="blue">${top+y}</text>`);
  }
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">${lines.join("")}</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/recheck-${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number][] = [
    ["newbase-sophia-seitlich-ring", "sophia-seitlich-ring", 445, 475, 220],
    ["newbase-claire-frontal-ring", "claire-frontal-ring", 515, 650, 220],
    ["newbase-claire-seitlich-ring", "claire-seitlich-ring", 490, 758, 220],
    ["newbase-jen-dreiviertelprofil-ring", "jen-dvp-ring", 515, 718, 220],
    ["newbase-jen-seitlich-ring", "jen-seitlich-ring", 525, 515, 220],
    ["newbase-amara-dreiviertelprofil-ring", "amara-dvp-ring", 540, 788, 220],
    ["newbase-amara-seitlich-ring", "amara-seitlich-ring", 495, 705, 220],
  ];
  await Promise.all(targets.map(([src, name, cx, cy, half]) => zoom(src, name, cx, cy, half)));
  console.log("done");
}
main();
