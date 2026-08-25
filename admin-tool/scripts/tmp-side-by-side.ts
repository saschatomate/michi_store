import sharp from "sharp";
const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad/e2e";

async function sideBySide(name: string, x: number, y: number, half: number, scale: number) {
  const before = await sharp(`${DIR}/before-color-fix/${name}.png`)
    .extract({ left: x - half, top: y - half, width: half * 2, height: half * 2 })
    .resize((half * 2) * scale, (half * 2) * scale)
    .png().toBuffer();
  const after = await sharp(`${DIR}/${name}.png`)
    .extract({ left: x - half, top: y - half, width: half * 2, height: half * 2 })
    .resize((half * 2) * scale, (half * 2) * scale)
    .png().toBuffer();
  const w = (half * 2) * scale;
  const h = (half * 2) * scale;
  const canvas = sharp({ create: { width: w * 2 + 10, height: h, channels: 3, background: { r: 255, g: 0, b: 0 } } });
  const buf = await canvas.composite([{ input: before, left: 0, top: 0 }, { input: after, left: w + 10, top: 0 }]).png().toBuffer();
  await sharp(buf).toFile(`${DIR}/sxs-${name}.png`);
}

async function main() {
  await sideBySide("ring-sophia-frontal", 760, 780, 90, 4);
  await sideBySide("ohr-sophia-frontal", 670, 400, 90, 4);
  console.log("done");
}
main();
