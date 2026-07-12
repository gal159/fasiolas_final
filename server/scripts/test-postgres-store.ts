// PostgresAuthUserStore testas su pg-mem (in-memory Postgres emuliatorius).
// Paleidimas: npx tsx scripts/test-postgres-store.ts
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { PostgresAuthUserStore, type AuthUser } from "../src/authUserStore";

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "a".repeat(32),
    email: "test@example.com",
    playerName: "Testeris",
    passwordHash: "salt:hash",
    hasCompletedProfileSetup: false,
    activeProfileSlot: "A",
    profileSlots: {} as AuthUser["profileSlots"],
    account: {
      points: 250,
      registeredAt: 1,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      unlocked: { avatars: [], hats: [], skins: [], effects: [], backgrounds: [], tables: [] },
    },
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function assert(cond: unknown, label: string): void {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`OK: ${label}`);
}

async function main(): Promise<void> {
  const mem = newDb();

  // pg-mem nepalaiko CREATE TABLE IF NOT EXISTS su inline constraint'ais,
  // tad DDL perimame ir ivykdome be IF NOT EXISTS. CRUD uzklausos vykdomos realiai.
  let tableCreated = false;
  mem.public.interceptQueries((sql) => {
    if (/CREATE TABLE IF NOT EXISTS auth_users/i.test(sql)) {
      if (!tableCreated) {
        mem.public.none(
          "CREATE TABLE auth_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, reset_token_hash TEXT, reset_token_expires_at BIGINT, doc JSONB NOT NULL)",
        );
        tableCreated = true;
      }
      return [];
    }
    if (/CREATE INDEX IF NOT EXISTS/i.test(sql)) {
      return [];
    }
    return null;
  });

  const { Pool: MemPool } = mem.adapters.createPg();
  const store = new PostgresAuthUserStore("postgres://mem", new MemPool() as unknown as Pool);

  await store.init();
  await store.init(); // idempotentiskas

  const user = makeUser();
  await store.insert(user);

  const byEmail = await store.findByEmail("test@example.com");
  assert(byEmail?.id === user.id, "findByEmail randa irasa");
  assert(byEmail?.account.points === 250, "JSONB dokumentas islaiko points");

  const byId = await store.findById(user.id);
  assert(byId?.email === user.email, "findById randa irasa");

  assert((await store.findByEmail("kitas@example.com")) === null, "findByEmail grazina null nerastam");

  // patch: taskai + updatedAt
  await store.patch(user.id, { account: { ...user.account, points: 900 }, updatedAt: 5 });
  const patched = await store.findById(user.id);
  assert(patched?.account.points === 900, "patch atnaujina account.points");
  assert(patched?.updatedAt === 5, "patch atnaujina updatedAt");
  assert(patched?.playerName === "Testeris", "patch nekeicia kitu lauku");

  // reset token paieska
  await store.patch(user.id, { resetTokenHash: "tok123", resetTokenExpiresAt: 1000 });
  assert((await store.findByResetToken("tok123", 999))?.id === user.id, "findByResetToken randa galiojanti");
  assert((await store.findByResetToken("tok123", 1001)) === null, "findByResetToken atmete pasibaigusi");
  assert((await store.findByResetToken("kitas", 999)) === null, "findByResetToken atmete neteisinga hash");

  // email pakeitimas per patch atnaujina paieskos stulpeli
  await store.patch(user.id, { email: "naujas@example.com" });
  assert((await store.findByEmail("naujas@example.com"))?.id === user.id, "patch email sinchronizuoja stulpeli");

  // upsert (migracijos kelias)
  await store.upsert(makeUser({ id: user.id, email: "naujas@example.com", playerName: "Perrasytas" }));
  assert((await store.findById(user.id))?.playerName === "Perrasytas", "upsert perraso esama irasa");

  const second = makeUser({ id: "b".repeat(32), email: "antras@example.com" });
  await store.upsert(second);
  assert((await store.findById(second.id))?.email === "antras@example.com", "upsert sukuria nauja irasa");

  // paieska pagal zaidimo varda (case-insensitive)
  const byName = await store.findAllByPlayerName("PERRASYTAS");
  assert(byName.length === 1 && byName[0].id === user.id, "findAllByPlayerName randa nepaisant raidziu dydzio");
  assert((await store.findAllByPlayerName("nesamas")).length === 0, "findAllByPlayerName grazina tuscia nerastam");

  // lyderiu lentele: rikiavimas pagal taskus mazejancia tvarka
  const third = makeUser({ id: "d".repeat(32), email: "trecias@example.com", playerName: "Turtingas" });
  third.account = { ...third.account, points: 9000 };
  await store.upsert(third);
  const top = await store.topPlayers(2);
  assert(top.length === 2, "topPlayers grazina prasyta kieki");
  assert(top[0].id === third.id, "topPlayers pirmas turi daugiausia tasku");
  assert((top[0].account.points ?? 0) >= (top[1].account.points ?? 0), "topPlayers rikiuoja mazejancia tvarka");

  // unikalus email
  let duplicateBlocked = false;
  try {
    await store.insert(makeUser({ id: "c".repeat(32), email: "antras@example.com" }));
  } catch {
    duplicateBlocked = true;
  }
  assert(duplicateBlocked, "unikalus email indeksas blokuoja dublikata");

  console.log("VISI TESTAI PRAEJO");
}

void main();
