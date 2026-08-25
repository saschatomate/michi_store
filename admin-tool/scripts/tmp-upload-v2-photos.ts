import { readFile } from "fs/promises";
import { uploadGeneratedImage } from "../src/lib/image-storage";

const DIR = "/private/tmp/claude-501/-Users-saschas-Documents-repos-Michi/58799c65-aa2c-42a2-8cb0-6a7feaf8feb3/scratchpad";

async function main() {
  const models = ["sophia", "claire", "jen", "amara"];
  const poses = ["frontal", "dreiviertelprofil", "seitlich"];
  const suffixes = ["hals", "ring", "ohr"];

  const results: { path: string; url: string }[] = [];
  for (const model of models) {
    for (const pose of poses) {
      for (const suffix of suffixes) {
        const localFile = `${DIR}/newbase-${model}-${pose}-${suffix}.png`;
        const buffer = await readFile(localFile);
        const remotePath = `pose-base/${model}-${pose}-${suffix}-v2.png`;
        const { url } = await uploadGeneratedImage(buffer, remotePath);
        results.push({ path: remotePath, url });
        console.log(`uploaded ${remotePath}`);
      }
    }
  }
  console.log(`\nDone. ${results.length} files uploaded.`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
