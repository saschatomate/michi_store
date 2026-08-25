import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";
const W = 1024, H = 1536;

async function mark2(src: string, name: string, x1: number, y1: number, x2: number, y2: number) {
  const buf = await sharp(`${DIR}/${src}.png`).resize(Math.round(W*0.7), Math.round(H*0.7)).png().toBuffer();
  const scale = 0.7;
  const lx1 = x1*scale, ly1 = y1*scale, lx2 = x2*scale, ly2 = y2*scale;
  const svg = `<svg width="${Math.round(W*0.7)}" height="${Math.round(H*0.7)}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${lx1}" cy="${ly1}" r="9" fill="none" stroke="cyan" stroke-width="3"/>
    <circle cx="${lx2}" cy="${ly2}" r="9" fill="none" stroke="magenta" stroke-width="3"/>
  </svg>`;
  const svgBuf = await sharp(Buffer.from(svg)).png().toBuffer();
  await sharp(buf).composite([{ input: svgBuf }]).png().toFile(`${DIR}/${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number, number][] = [
    ["newbase-sophia-frontal-hals", "chain-sophia-frontal", 33, 52, 67, 52],
    ["newbase-sophia-dreiviertelprofil-hals", "chain-sophia-dvp", 36, 50, 70, 52],
    ["newbase-sophia-seitlich-hals", "chain-sophia-seitlich", 30, 48, 66, 50],
    ["newbase-claire-frontal-hals", "chain-claire-frontal", 31, 52, 65, 52],
    ["newbase-claire-dreiviertelprofil-hals", "chain-claire-dvp", 39, 44, 74, 44],
    ["newbase-claire-seitlich-hals", "chain-claire-seitlich", 27, 49, 81, 48],
    ["newbase-jen-frontal-hals", "chain-jen-frontal", 29, 47, 68, 47],
    ["newbase-jen-dreiviertelprofil-hals", "chain-jen-dvp", 27, 49, 76, 49],
    ["newbase-jen-seitlich-hals", "chain-jen-seitlich", 24, 49, 73, 49],
    ["newbase-amara-frontal-hals", "chain-amara-frontal", 29, 42, 73, 42],
    ["newbase-amara-dreiviertelprofil-hals", "chain-amara-dvp", 27, 42, 68, 42],
    ["newbase-amara-seitlich-hals", "chain-amara-seitlich", 27, 46, 64, 46],
  ];
  for (const [src, name, x1p, y1p, x2p, y2p] of targets) {
    await mark2(src, name, (x1p/100)*W, (y1p/100)*H, (x2p/100)*W, (y2p/100)*H);
  }
  console.log("done");
}
main();
