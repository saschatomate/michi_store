import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";
const W = 1024, H = 1536;

async function overlay(src: string, name: string, anchorX: number, anchorY: number, clX: number, clY: number, crX: number, crY: number) {
  const img = sharp(`${DIR}/${src}.png`);
  const ax = (anchorX/100)*W, ay = (anchorY/100)*H;
  const clx = (clX/100)*W, cly = (clY/100)*H;
  const crx = (crX/100)*W, cry = (crY/100)*H;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${ax}" cy="${ay}" r="14" fill="none" stroke="red" stroke-width="4"/>
    <line x1="${ax-22}" y1="${ay}" x2="${ax+22}" y2="${ay}" stroke="red" stroke-width="3"/>
    <line x1="${ax}" y1="${ay-22}" x2="${ax}" y2="${ay+22}" stroke="red" stroke-width="3"/>
    <circle cx="${clx}" cy="${cly}" r="10" fill="none" stroke="cyan" stroke-width="4"/>
    <circle cx="${crx}" cy="${cry}" r="10" fill="none" stroke="magenta" stroke-width="4"/>
  </svg>`;
  const svgBuf = await sharp(Buffer.from(svg)).png().toBuffer();
  const buf = await img.composite([{ input: svgBuf }]).resize(Math.round(W*0.6), Math.round(H*0.6)).png().toBuffer();
  await sharp(buf).toFile(`${DIR}/halsoverlay-${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number, number, number, number][] = [
    ["newbase-sophia-frontal-hals", "sophia-frontal", 50, 64, 33, 52, 67, 52],
    ["newbase-sophia-dreiviertelprofil-hals", "sophia-dvp", 52, 63, 36, 50, 70, 52],
    ["newbase-sophia-seitlich-hals", "sophia-seitlich", 48, 62, 30, 48, 66, 50],
    ["newbase-claire-frontal-hals", "claire-frontal", 48, 64, 31, 52, 65, 52],
    ["newbase-claire-dreiviertelprofil-hals", "claire-dvp", 46, 53, 39, 44, 74, 44],
    ["newbase-claire-seitlich-hals", "claire-seitlich", 56, 55, 27, 49, 81, 48],
    ["newbase-jen-frontal-hals", "jen-frontal", 49, 57, 29, 47, 68, 47],
    ["newbase-jen-dreiviertelprofil-hals", "jen-dvp", 54, 60, 27, 49, 76, 49],
    ["newbase-jen-seitlich-hals", "jen-seitlich", 45, 60, 24, 49, 73, 49],
    ["newbase-amara-frontal-hals", "amara-frontal", 51, 61, 29, 42, 73, 42],
    ["newbase-amara-dreiviertelprofil-hals", "amara-dvp", 52, 59, 27, 42, 68, 42],
    ["newbase-amara-seitlich-hals", "amara-seitlich", 45, 61, 27, 46, 64, 46],
  ];
  for (const [src, name, ax, ay, clx, cly, crx, cry] of targets) {
    await overlay(src, name, ax, ay, clx, cly, crx, cry);
  }
  console.log("done");
}
main();
