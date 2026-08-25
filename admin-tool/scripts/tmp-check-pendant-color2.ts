import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad/e2e";

async function crop(name: string, x: number, y: number, half: number, scale: number) {
  const buf = await sharp(`${DIR}/${name}.png`)
    .extract({ left: x - half, top: y - half, width: half * 2, height: half * 2 })
    .resize((half * 2) * scale, (half * 2) * scale)
    .png()
    .toBuffer();
  await sharp(buf).toFile(`${DIR}/colorcheck-${name}.png`);
}

async function main() {
  await crop("ring-sophia-frontal", 760, 780, 90, 4);
  await crop("ohr-sophia-frontal", 670, 400, 90, 4);
  console.log("done");
}
main();
