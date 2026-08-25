import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function zoom(src: string, name: string, cx: number, cy: number, halfW: number, halfH: number, step: number, scale: number) {
  const left = Math.max(0, cx - halfW);
  const top = Math.max(0, cy - halfH);
  const width = halfW * 2;
  const height = halfH * 2;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(Math.round(width * scale), Math.round(height * scale), { kernel: "nearest" }).png().toBuffer();
  const lines: string[] = [];
  for (let x = 0; x <= width; x += step) {
    const sx = x * scale;
    lines.push(`<line x1="${sx}" y1="0" x2="${sx}" y2="${height*scale}" stroke="rgba(255,0,0,0.45)" stroke-width="1"/>`);
    lines.push(`<text x="${sx+2}" y="14" font-size="12" fill="red">${left+x}</text>`);
  }
  for (let y = 0; y <= height; y += step) {
    const sy = y * scale;
    lines.push(`<line x1="0" y1="${sy}" x2="${width*scale}" y2="${sy}" stroke="rgba(0,0,255,0.45)" stroke-width="1"/>`);
    lines.push(`<text x="2" y="${sy+12}" font-size="12" fill="blue">${top+y}</text>`);
  }
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">${lines.join("")}</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/recheck2-${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number, number, number, number][] = [
    // src, name, cx, cy, halfW, halfH, step, scale
    ["newbase-sophia-seitlich-ring", "sophia-seitlich-ring", 680, 360, 160, 160, 25, 2.2],
    ["newbase-claire-frontal-ring", "claire-frontal-ring", 650, 900, 200, 200, 25, 1.8],
    ["newbase-claire-seitlich-ring", "claire-seitlich-ring", 650, 900, 200, 200, 25, 1.8],
    ["newbase-jen-dreiviertelprofil-ring", "jen-dvp-ring2", 550, 700, 280, 280, 30, 1.6],
    ["newbase-jen-seitlich-ring", "jen-seitlich-ring2", 550, 570, 280, 280, 30, 1.6],
  ];
  await Promise.all(targets.map(([src, name, cx, cy, halfW, halfH, step, scale]) => zoom(src, name, cx, cy, halfW, halfH, step, scale)));
  console.log("done");
}
main();
