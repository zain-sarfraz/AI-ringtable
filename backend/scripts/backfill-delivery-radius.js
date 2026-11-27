/**
 * Backfill / clamp restaurants.service_radius_km to the 1–20 KM delivery-radius range.
 * Missing values → 5. Idempotent: a second run reports 0 updates when already in range.
 *
 * Usage (from backend/):
 *   node scripts/backfill-delivery-radius.js           # apply updates
 *   node scripts/backfill-delivery-radius.js --dry-run  # print offenders only, no writes
 */
import "../src/loadEnv.js";
import { getKnex } from "../src/db.js";

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
const knex = getKnex();

try {
  const nullRows = await knex("restaurants")
    .whereNull("service_radius_km")
    .select("id", "name", "service_radius_km");

  const lowRows = await knex("restaurants")
    .whereNotNull("service_radius_km")
    .andWhere("service_radius_km", "<", 1)
    .select("id", "name", "service_radius_km");

  const highRows = await knex("restaurants")
    .whereNotNull("service_radius_km")
    .andWhere("service_radius_km", ">", 20)
    .select("id", "name", "service_radius_km");

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          wouldSetNullTo5: nullRows,
          wouldClampBelow1To1: lowRows,
          wouldClampAbove20To20: highRows,
          counts: {
            nullOrMissing: nullRows.length,
            below1: lowRows.length,
            above20: highRows.length,
          },
        },
        null,
        2,
      ),
    );
  } else {
    const nullFixed = await knex("restaurants")
      .whereNull("service_radius_km")
      .update({ service_radius_km: 5.0 });

    const lowFixed = await knex("restaurants")
      .whereNotNull("service_radius_km")
      .andWhere("service_radius_km", "<", 1)
      .update({ service_radius_km: 1.0 });

    const highFixed = await knex("restaurants")
      .whereNotNull("service_radius_km")
      .andWhere("service_radius_km", ">", 20)
      .update({ service_radius_km: 20.0 });

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: false,
          nullOrMissingSetTo5: nullFixed,
          below1ClampedTo1: lowFixed,
          above20ClampedTo20: highFixed,
          note: "Safe to run twice — second run updates 0 rows when all values are already in 1–20.",
        },
        null,
        2,
      ),
    );
  }
} catch (e) {
  console.error("[backfill-delivery-radius]", e.message || e);
  process.exitCode = 1;
} finally {
  await knex.destroy();
}
