import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function dotgrid(src: string, name: string, cx: number, cy: number, halfW: number, halfH: number, step: number, scale: number) {
  const left = Math.max(0, cx - halfW);
  const top = Math.max(0, cy - halfH);
  const width = Math.min(halfW * 2, 1024 - left);
  const height = Math.min(halfH * 2, 1536 - top);
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
      const dy = row % 2 === 0 ? -6 : 16;
      dots.push(`<text x="${sx+4}" y="${sy+dy}" font-size="13" fill="lime" stroke="black" stroke-width="0.5">${cxv},${cyv}</text>`);
    }
  }
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">${dots.join("")}</svg>`;
  const svgBuf = await sharp(Buffer.from(svg)).png().toBuffer();
  await sharp(buf).composite([{ input: svgBuf }]).png().toFile(`${DIR}/${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number, number, number, number][] = [
    ["newbase-claire-frontal-hals", "pupil4-claire", 400, 340, 320, 90, 40, 2.2],
    ["newbase-jen-frontal-hals", "pupil4-jen", 380, 350, 320, 90, 40, 2.2],
    ["newbase-amara-frontal-hals", "pupil4-amara", 390, 400, 320, 90, 40, 2.2],
  ];
  for (const [src, name, cx, cy, halfW, halfH, step, scale] of targets) {
    await dotgrid(src, name, cx, cy, halfW, halfH, step, scale);
  }
  console.log("done");
}
main();
