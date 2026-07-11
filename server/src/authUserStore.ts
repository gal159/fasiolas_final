import Datastore from "nedb-promises";
import { Pool } from "pg";
import { resolve } from "node:path";
import type { PlayerAccountState, PlayerProfile, ProfileSlotMap } from "../../shared/src/types";

export type AuthUser = {
  id: string;
  email: string;
  playerName: string;
  passwordHash: string;
  hasCompletedProfileSetup: boolean;
  activeProfileSlot: PlayerProfile["profileSlot"];
  profileSlots: ProfileSlotMap;
  account: PlayerAccountState;
  resetTokenHash: string | null;
  resetTokenExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export interface AuthUserStore {
  init(): Promise<void>;
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  findByResetToken(tokenHash: string, notExpiredBefore: number): Promise<AuthUser | null>;
  insert(user: AuthUser): Promise<void>;
  patch(id: string, fields: Partial<AuthUser>): Promise<void>;
}

// ---------------------------------------------------------------------------
// NeDB (failas diske) - naudojamas lokaliai, kai DATABASE_URL nenustatytas.
// ---------------------------------------------------------------------------

export class NedbAuthUserStore implements AuthUserStore {
  private readonly db: Datastore<AuthUser>;

  constructor(filePath: string) {
    this.db = Datastore.create({ filename: filePath, autoload: true }) as Datastore<AuthUser>;
  }

  async init(): Promise<void> {
    await this.db.ensureIndex({ fieldName: "email", unique: true });
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    return (await this.db.findOne({ email })) ?? null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    return (await this.db.findOne({ id })) ?? null;
  }

  async findByResetToken(tokenHash: string, notExpiredBefore: number): Promise<AuthUser | null> {
    return (
      (await this.db.findOne({
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: { $gte: notExpiredBefore },
      })) ?? null
    );
  }

  async insert(user: AuthUser): Promise<void> {
    await this.db.insert(user);
  }

  async patch(id: string, fields: Partial<AuthUser>): Promise<void> {
    await this.db.update({ id }, { $set: fields });
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL - naudojamas, kai nustatytas DATABASE_URL.
// Visas vartotojo dokumentas laikomas JSONB stulpelyje, o paieskos laukai
// (email, reset token) dubliuojami indeksuotuose stulpeliuose.
// ---------------------------------------------------------------------------

export class PostgresAuthUserStore implements AuthUserStore {
  private readonly pool: Pool;

  constructor(connectionString: string, poolOverride?: Pool) {
    if (poolOverride) {
      this.pool = poolOverride;
      return;
    }
    const needsSsl = /render\.com|neon\.tech|supabase\.co|amazonaws\.com|azure\.com/i.test(connectionString);
    this.pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        reset_token_hash TEXT,
        reset_token_expires_at BIGINT,
        doc JSONB NOT NULL
      )
    `);
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS auth_users_reset_token_idx ON auth_users (reset_token_hash)",
    );
  }

  private rowToUser(row: { doc: AuthUser } | undefined): AuthUser | null {
    return row ? row.doc : null;
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    const result = await this.pool.query<{ doc: AuthUser }>(
      "SELECT doc FROM auth_users WHERE email = $1",
      [email],
    );
    return this.rowToUser(result.rows[0]);
  }

  async findById(id: string): Promise<AuthUser | null> {
    const result = await this.pool.query<{ doc: AuthUser }>(
      "SELECT doc FROM auth_users WHERE id = $1",
      [id],
    );
    return this.rowToUser(result.rows[0]);
  }

  async findByResetToken(tokenHash: string, notExpiredBefore: number): Promise<AuthUser | null> {
    const result = await this.pool.query<{ doc: AuthUser }>(
      "SELECT doc FROM auth_users WHERE reset_token_hash = $1 AND reset_token_expires_at >= $2",
      [tokenHash, notExpiredBefore],
    );
    return this.rowToUser(result.rows[0]);
  }

  async insert(user: AuthUser): Promise<void> {
    await this.pool.query(
      "INSERT INTO auth_users (id, email, reset_token_hash, reset_token_expires_at, doc) VALUES ($1, $2, $3, $4, $5)",
      [user.id, user.email, user.resetTokenHash, user.resetTokenExpiresAt, JSON.stringify(user)],
    );
  }

  async upsert(user: AuthUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_users (id, email, reset_token_hash, reset_token_expires_at, doc)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         reset_token_hash = EXCLUDED.reset_token_hash,
         reset_token_expires_at = EXCLUDED.reset_token_expires_at,
         doc = EXCLUDED.doc`,
      [user.id, user.email, user.resetTokenHash, user.resetTokenExpiresAt, JSON.stringify(user)],
    );
  }

  async patch(id: string, fields: Partial<AuthUser>): Promise<void> {
    const current = await this.findById(id);
    if (!current) {
      return;
    }
    const next: AuthUser = { ...current, ...fields };
    await this.pool.query(
      "UPDATE auth_users SET email = $2, reset_token_hash = $3, reset_token_expires_at = $4, doc = $5 WHERE id = $1",
      [id, next.email, next.resetTokenHash, next.resetTokenExpiresAt, JSON.stringify(next)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------------------

export function createAuthUserStore(): AuthUserStore {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    console.log("Auth store: PostgreSQL (DATABASE_URL)");
    return new PostgresAuthUserStore(databaseUrl);
  }

  const filePath = process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR, "auth-users.db")
    : resolve(process.cwd(), "data", "auth-users.db");
  console.log(`Auth store: NeDB (${filePath})`);
  return new NedbAuthUserStore(filePath);
}
