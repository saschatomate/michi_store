import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function mark(src: string, name: string, x: number, y: number, half: number) {
  const left = Math.max(0, x - half);
  const top = Math.max(0, y - half);
  const width = Math.min(half * 2, 1024 - left);
  const height = Math.min(half * 2, 1536 - top);
  const scale = 2.4;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(Math.round(width * scale), Math.round(height * scale)).png().toBuffer();
  const lx = (x - left) * scale;
  const ly = (y - top) * scale;
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${lx-25}" y1="${ly}" x2="${lx+25}" y2="${ly}" stroke="lime" stroke-width="2"/>
    <line x1="${lx}" y1="${ly-25}" x2="${lx}" y2="${ly+25}" stroke="lime" stroke-width="2"/>
    <circle cx="${lx}" cy="${ly}" r="6" fill="none" stroke="red" stroke-width="2"/>
  </svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/ohrverify-${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number][] = [
    ["newbase-sophia-frontal-ohr", "sophia-frontal", 618, 405, 110],
    ["newbase-sophia-dreiviertelprofil-ohr", "sophia-dvp", 545, 345, 110],
    ["newbase-sophia-seitlich-ohr", "sophia-seitlich", 495, 285, 110],
    ["newbase-claire-frontal-ohr", "claire-frontal", 310, 460, 110],
    ["newbase-claire-dreiviertelprofil-ohr", "claire-dvp", 320, 415, 110],
    ["newbase-claire-seitlich-ohr", "claire-seitlich", 325, 425, 110],
    ["newbase-jen-frontal-ohr", "jen-frontal", 800, 425, 110],
    ["newbase-jen-dreiviertelprofil-ohr", "jen-dvp", 665, 350, 110],
    ["newbase-jen-seitlich-ohr", "jen-seitlich", 715, 405, 110],
    ["newbase-amara-frontal-ohr", "amara-frontal", 645, 385, 110],
    ["newbase-amara-dreiviertelprofil-ohr", "amara-dvp", 685, 400, 110],
    ["newbase-amara-seitlich-ohr", "amara-seitlich", 650, 390, 110],
  ];
  await Promise.all(targets.map(([src, name, x, y, half]) => mark(src, name, x, y, half)));
  console.log("done");
}
main();
