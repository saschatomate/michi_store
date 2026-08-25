import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function dotgrid(src: string, name: string, cx: number, cy: number, halfW: number, halfH: number, step: number, scale: number) {
  const left = Math.max(0, cx - halfW);
  const top = Math.max(0, cy - halfH);
  const width = halfW * 2;
  const height = halfH * 2;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(Math.round(width * scale), Math.round(height * scale), { kernel: "nearest" }).png().toBuffer();
  const dots: string[] = [];
  let row = 0;
  for (let y = 0; y <= height; y += step, row++) {
    for (let x = 0; x <= width; x += step) {
      const sx = x * scale;
      const sy = y * scale;
      const cxv = left + x;
      const cyv = top + y;
      dots.push(`<circle cx="${sx}" cy="${sy}" r="3" fill="yellow" stroke="black" stroke-width="0.7"/>`);
      const dy = row % 2 === 0 ? -5 : 15;
      dots.push(`<text x="${sx+4}" y="${sy+dy}" font-size="12" fill="lime" stroke="black" stroke-width="0.4">${cxv},${cyv}</text>`);
    }
  }
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">${dots.join("")}</svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/dotgrid2-${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number, number, number, number][] = [
    ["newbase-jen-dreiviertelprofil-ring", "jen-dvp-joint", 708, 780, 140, 140, 20, 3.0],
    ["newbase-jen-seitlich-ring", "jen-seitlich-joint", 655, 570, 140, 140, 20, 3.0],
    ["newbase-amara-seitlich-ring", "amara-seitlich-joint", 620, 720, 140, 140, 20, 3.0],
    ["newbase-sophia-seitlich-ring", "sophia-seitlich-joint", 450, 460, 140, 140, 20, 3.0],
  ];
  await Promise.all(targets.map(([src, name, cx, cy, halfW, halfH, step, scale]) => dotgrid(src, name, cx, cy, halfW, halfH, step, scale)));
  console.log("done");
}
main();
