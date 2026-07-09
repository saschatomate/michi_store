import fs from "node:fs";
import path from "node:path";
import { importCsvBuffer } from "@/lib/csv-import";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run import -- <path-to-csv>");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  const buffer = fs.readFileSync(absolutePath);
  const result = await importCsvBuffer(buffer, path.basename(absolutePath));

  console.log(`Import abgeschlossen (Run #${result.runId}):`);
  console.log(`  Zeilen gesamt:     ${result.rowsTotal}`);
  console.log(`  Neu angelegt:      ${result.rowsInserted}`);
  console.log(`  Aktualisiert:      ${result.rowsUpdated}`);
  console.log(`  Fehler:            ${result.rowsError}`);
  if (result.errors.length > 0) {
    console.log("Erste Fehler:");
    result.errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
