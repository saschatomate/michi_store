import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";
const W = 1024, H = 1536;

async function mark(src: string, name: string, x: number, y: number, half: number) {
  const left = Math.max(0, x - half);
  const top = Math.max(0, y - half);
  const width = Math.min(half * 2, W - left);
  const height = Math.min(half * 2, H - top);
  const scale = 1.8;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(Math.round(width * scale), Math.round(height * scale)).png().toBuffer();
  const lx = (x - left) * scale;
  const ly = (y - top) * scale;
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${lx-25}" y1="${ly}" x2="${lx+25}" y2="${ly}" stroke="lime" stroke-width="2"/>
    <line x1="${lx}" y1="${ly-25}" x2="${lx}" y2="${ly+25}" stroke="lime" stroke-width="2"/>
    <circle cx="${lx}" cy="${ly}" r="6" fill="none" stroke="red" stroke-width="2"/>
  </svg>`;
  const svgBuf = await sharp(Buffer.from(svg)).png().toBuffer();
  await sharp(buf).composite([{ input: svgBuf }]).png().toFile(`${DIR}/${name}.png`);
}

async function main() {
  const targets: [string, string, number, number][] = [
    ["newbase-sophia-frontal-hals", "hals-sophia-frontal", 50, 64],
    ["newbase-sophia-dreiviertelprofil-hals", "hals-sophia-dvp", 52, 63],
    ["newbase-sophia-seitlich-hals", "hals-sophia-seitlich", 48, 62],
    ["newbase-claire-frontal-hals", "hals-claire-frontal", 48, 64],
    ["newbase-claire-dreiviertelprofil-hals", "hals-claire-dvp", 46, 53],
    ["newbase-claire-seitlich-hals", "hals-claire-seitlich", 56, 55],
    ["newbase-jen-frontal-hals", "hals-jen-frontal", 49, 57],
    ["newbase-jen-dreiviertelprofil-hals", "hals-jen-dvp", 54, 60],
    ["newbase-jen-seitlich-hals", "hals-jen-seitlich", 45, 60],
    ["newbase-amara-frontal-hals", "hals-amara-frontal", 51, 61],
    ["newbase-amara-dreiviertelprofil-hals", "hals-amara-dvp", 52, 59],
    ["newbase-amara-seitlich-hals", "hals-amara-seitlich", 45, 61],
  ];
  for (const [src, name, ax, ay] of targets) {
    const x = Math.round((ax / 100) * W);
    const y = Math.round((ay / 100) * H);
    await mark(src, name, x, y, 220);
  }
  console.log("done");
}
main();
