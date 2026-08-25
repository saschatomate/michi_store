import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function markAndZoom(src: string, name: string, cx: number, cy: number) {
  const half = 130;
  const left = Math.max(0, cx - half);
  const top = Math.max(0, cy - half);
  const width = half * 2;
  const height = half * 2;
  const scale = 3;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(width * scale, height * scale, { kernel: "nearest" }).png().toBuffer();
  const ax = (cx - left) * scale;
  const ay = (cy - top) * scale;
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${ax-20}" y1="${ay}" x2="${ax+20}" y2="${ay}" stroke="lime" stroke-width="3"/>
    <line x1="${ax}" y1="${ay-20}" x2="${ax}" y2="${ay+20}" stroke="lime" stroke-width="3"/>
  </svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/mark-${name}.png`);
}

async function main() {
  const candidates: [string, string, number, number][] = [
    ["newbase-sophia-frontal-ring", "sophia-frontal-ring", 580, 790],
    ["newbase-sophia-dreiviertelprofil-ring", "sophia-dvp-ring", 590, 630],
    ["newbase-sophia-seitlich-ring", "sophia-seitlich-ring", 445, 475],
    ["newbase-claire-frontal-ring", "claire-frontal-ring", 515, 650],
    ["newbase-claire-dreiviertelprofil-ring", "claire-dvp-ring", 570, 845],
    ["newbase-claire-seitlich-ring", "claire-seitlich-ring", 490, 758],
    ["newbase-jen-frontal-ring", "jen-frontal-ring", 510, 918],
    ["newbase-jen-dreiviertelprofil-ring", "jen-dvp-ring", 515, 718],
    ["newbase-jen-seitlich-ring", "jen-seitlich-ring", 525, 515],
    ["newbase-amara-frontal-ring", "amara-frontal-ring", 450, 935],
    ["newbase-amara-dreiviertelprofil-ring", "amara-dvp-ring", 540, 788],
    ["newbase-amara-seitlich-ring", "amara-seitlich-ring", 495, 705],
  ];
  await Promise.all(candidates.map(([src, name, cx, cy]) => markAndZoom(src, name, cx, cy)));
  console.log("done");
}
main();
