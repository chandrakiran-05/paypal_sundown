/** Idempotently seed a local replay workspace. */
import { snapshot, log } from "../apps/web/lib/store";
const data = snapshot();
if (!data.logs.length)
  log(
    "Workspace seeded: Horizon Supply, 12 merchants, six synthetic parity transcripts.",
  );
console.log("Seeded replay workspace.");
