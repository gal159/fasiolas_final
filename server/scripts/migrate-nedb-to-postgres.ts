// Vienkartine migracija: perkelia vartotojus is NeDB failo i PostgreSQL.
//
// Naudojimas (is server/ katalogo):
//   DATABASE_URL=postgres://... npx tsx scripts/migrate-nedb-to-postgres.ts [kelias/iki/auth-users.db]
//
// Jei failo kelias nenurodytas, imamas DATA_DIR/auth-users.db arba ./data/auth-users.db.
// Skriptas saugus kartoti: esami irasai atnaujinami (upsert pagal id).

import "dotenv/config";
import Datastore from "nedb-promises";
import { resolve } from "node:path";
import { PostgresAuthUserStore, type AuthUser } from "../src/authUserStore";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("Nustatyk DATABASE_URL aplinkos kintamaji (postgres://...)");
    process.exit(1);
  }

  const nedbPath =
    process.argv[2] ??
    (process.env.DATA_DIR
      ? resolve(process.env.DATA_DIR, "auth-users.db")
      : resolve(process.cwd(), "data", "auth-users.db"));

  console.log(`NeDB saltinis: ${nedbPath}`);
  const nedb = Datastore.create({ filename: nedbPath, autoload: true }) as Datastore<AuthUser>;
  const users = await nedb.find({});
  console.log(`Rasta vartotoju: ${users.length}`);

  const store = new PostgresAuthUserStore(databaseUrl);
  await store.init();

  let migrated = 0;
  for (const raw of users) {
    // Numetam NeDB vidinius laukus.
    const { _id, ...user } = raw as AuthUser & { _id?: string };
    if (!user.id || !user.email) {
      console.warn("Praleistas irasas be id/email:", JSON.stringify(raw).slice(0, 80));
      continue;
    }
    await store.upsert(user as AuthUser);
    migrated += 1;
    console.log(`  OK ${user.email}`);
  }

  console.log(`Migruota: ${migrated}/${users.length}`);
  await store.close();
}

void main();
