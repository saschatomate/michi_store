import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function locate(src: string, name: string) {
  const buf = await sharp(`${DIR}/${src}.png`).resize(Math.round(1024*0.55), Math.round(1536*0.55)).png().toBuffer();
  await sharp(buf).toFile(`${DIR}/halslocate-${name}.png`);
}

async function main() {
  const models = ["sophia", "claire", "jen", "amara"];
  const poses = ["frontal", "dreiviertelprofil", "seitlich"];
  const targets: [string, string][] = [];
  for (const m of models) for (const p of poses) targets.push([`newbase-${m}-${p}-hals`, `${m}-${p}`]);
  await Promise.all(targets.map(([src, name]) => locate(src, name)));
  console.log("done");
}
main();
