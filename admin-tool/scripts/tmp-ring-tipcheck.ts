import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function mark(src: string, name: string, x: number, y: number, half: number) {
  const left = Math.max(0, x - half);
  const top = Math.max(0, y - half);
  const width = half * 2;
  const height = half * 2;
  const scale = 2.5;
  const img = sharp(`${DIR}/${src}.png`).extract({ left, top, width, height });
  const buf = await img.resize(Math.round(width * scale), Math.round(height * scale)).png().toBuffer();
  const lx = (x - left) * scale;
  const ly = (y - top) * scale;
  const svg = `<svg width="${width*scale}" height="${height*scale}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${lx-25}" y1="${ly}" x2="${lx+25}" y2="${ly}" stroke="lime" stroke-width="2"/>
    <line x1="${lx}" y1="${ly-25}" x2="${lx}" y2="${ly+25}" stroke="lime" stroke-width="2"/>
    <circle cx="${lx}" cy="${ly}" r="6" fill="none" stroke="red" stroke-width="2"/>
  </svg>`;
  await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toFile(`${DIR}/tipcheck-${name}.png`);
}

async function main() {
  const targets: [string, string, number, number, number][] = [
    ["newbase-jen-dreiviertelprofil-ring", "jen-dvp-tip", 708, 685, 110],
    ["newbase-jen-seitlich-ring", "jen-seitlich-tip", 595, 520, 110],
    ["newbase-amara-seitlich-ring", "amara-seitlich-tip", 520, 660, 110],
  ];
  await Promise.all(targets.map(([src, name, x, y, half]) => mark(src, name, x, y, half)));
  console.log("done");
}
main();
