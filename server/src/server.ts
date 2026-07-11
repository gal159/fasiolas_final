import "dotenv/config";
import cors from "cors";
import express from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAuthUserStore, type AuthUser } from "./authUserStore";
import { z } from "zod";
import {
  AVATAR_PRICE_OVERRIDES,
  AVATAR_RARITY,
  AVATAR_OPTIONS,
  CARD_BACKGROUND_OPTIONS,
  CARD_BACKGROUND_RARITY,
  EFFECT_RARITY,
  EFFECT_OPTIONS,
  HAT_RARITY,
  HAT_OPTIONS,
  PROFILE_COLOR_OPTIONS,
  PROFILE_SLOT_OPTIONS,
  RARITY_PRICES,
  SKIN_RARITY,
  SKIN_OPTIONS,
  TABLE_OPTIONS,
  TABLE_RARITY,
  type AuthBootstrapPayload,
  type PlayerAccountState,
  type PlayerCardInfo,
  type PlayerProfile,
  type ProfileSlotMap,
  type ShopItemId,
  type ShopItemType,
  type TurnAction,
} from "../../shared/src/types";
import { GameEngine } from "./gameEngine";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const APP_SECRET = process.env.APP_SECRET ?? "dev-secret-change-me";
const REGISTRATION_STARTER_POINTS = 250;
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS ?? CLIENT_URL;

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

const allowedOrigins = ALLOWED_ORIGINS_RAW.split(",")
  .map((origin) => normalizeOrigin(origin))
  .filter((origin) => origin.length > 0);

const app = express();
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  }),
);
app.use(express.json());
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const AUTH_USER_ID_REGEX = /^[a-f0-9]{32}$/i;

const registerSchema = z.object({
  email: z.string().trim().email().max(120),
  playerName: z.string().trim().min(2).max(24),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(120),
  password: z.string().min(1).max(128),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(120),
});

const profileSchema = z.object({
  baseColor: z.enum(PROFILE_COLOR_OPTIONS),
  avatarId: z.enum(AVATAR_OPTIONS),
  hatId: z.enum(HAT_OPTIONS),
  skinId: z.enum(SKIN_OPTIONS),
  effectId: z.enum(EFFECT_OPTIONS),
  cardBackgroundId: z.enum(CARD_BACKGROUND_OPTIONS),
  tableId: z.enum(TABLE_OPTIONS).optional().default("common_green"),
  profileSlot: z.enum(PROFILE_SLOT_OPTIONS),
});

const bootstrapSchema = z.object({
  email: z.string().trim().email().max(120),
});

const saveProfileSchema = z.object({
  email: z.string().trim().email().max(120),
  activeProfileSlot: z.enum(PROFILE_SLOT_OPTIONS),
  profile: profileSchema,
  completeSetup: z.boolean().optional(),
});

const authPurchaseSchema = z.object({
  email: z.string().trim().email().max(120),
  itemType: z.enum(["avatar", "hat", "skin", "effect", "background", "table"]),
  itemId: z.string().trim().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(256),
  password: z.string().min(8).max(128),
});

const authStore = createAuthUserStore();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createDefaultProfile(slot: PlayerProfile["profileSlot"] = PROFILE_SLOT_OPTIONS[0]): PlayerProfile {
  const slotIndex = PROFILE_SLOT_OPTIONS.findIndex((item) => item === slot);
  const normalizedIndex = Math.max(0, slotIndex);
  return {
    baseColor: PROFILE_COLOR_OPTIONS[normalizedIndex % PROFILE_COLOR_OPTIONS.length],
    avatarId: "warrior",
    hatId: "none",
    skinId: "default",
    effectId: "none",
    cardBackgroundId: "classic",
    tableId: "common_green",
    profileSlot: slot,
  };
}

function normalizeProfile(profile: PlayerProfile, slot: PlayerProfile["profileSlot"]): PlayerProfile {
  return {
    ...createDefaultProfile(slot),
    ...profile,
    profileSlot: slot,
    cardBackgroundId: CARD_BACKGROUND_OPTIONS.includes(profile.cardBackgroundId)
      ? profile.cardBackgroundId
      : "classic",
    tableId: TABLE_OPTIONS.includes(profile.tableId) ? profile.tableId : "common_green",
  };
}

function normalizeProfileSlots(profileSlots: ProfileSlotMap | undefined): ProfileSlotMap {
  const fallback = createDefaultProfileSlots();
  if (!profileSlots) {
    return fallback;
  }

  return {
    A: normalizeProfile(profileSlots.A ?? fallback.A, "A"),
    B: normalizeProfile(profileSlots.B ?? fallback.B, "B"),
    C: normalizeProfile(profileSlots.C ?? fallback.C, "C"),
  };
}

function createDefaultProfileSlots(): ProfileSlotMap {
  return {
    A: createDefaultProfile("A"),
    B: createDefaultProfile("B"),
    C: createDefaultProfile("C"),
  };
}

function createDefaultAccount(): PlayerAccountState {
  const defaultAvatars = AVATAR_OPTIONS.filter((id) => AVATAR_RARITY[id] === "common");
  const defaultBackgrounds = CARD_BACKGROUND_OPTIONS.filter((id) => CARD_BACKGROUND_RARITY[id] === "common");

  return {
    points: 0,
    registeredAt: Date.now(),
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    unlocked: {
      avatars: defaultAvatars,
      hats: HAT_OPTIONS.filter((id) => HAT_RARITY[id] === "common"),
      skins: SKIN_OPTIONS.filter((id) => SKIN_RARITY[id] === "common"),
      effects: EFFECT_OPTIONS.filter((id) => EFFECT_RARITY[id] === "common"),
      backgrounds: defaultBackgrounds,
      tables: TABLE_OPTIONS.filter((id) => TABLE_RARITY[id] === "common"),
    },
  };
}

function normalizeAccount(account: PlayerAccountState | undefined): PlayerAccountState {
  const fallback = createDefaultAccount();
  if (!account) {
    return fallback;
  }

  return {
    points: account.points ?? 0,
    registeredAt: account.registeredAt ?? fallback.registeredAt,
    gamesPlayed: account.gamesPlayed ?? 0,
    gamesWon: account.gamesWon ?? 0,
    gamesLost: account.gamesLost ?? 0,
    unlocked: {
      avatars: account.unlocked?.avatars ?? fallback.unlocked.avatars,
      hats: account.unlocked?.hats ?? fallback.unlocked.hats,
      skins: account.unlocked?.skins ?? fallback.unlocked.skins,
      effects: account.unlocked?.effects ?? fallback.unlocked.effects,
      backgrounds: account.unlocked?.backgrounds ?? fallback.unlocked.backgrounds,
      tables: account.unlocked?.tables ?? fallback.unlocked.tables,
    },
  };
}

function toBootstrapPayload(user: AuthUser): AuthBootstrapPayload {
  return {
    email: user.email,
    playerName: user.playerName,
    hasCompletedProfileSetup: user.hasCompletedProfileSetup,
    activeProfileSlot: user.activeProfileSlot,
    profileSlots: user.profileSlots,
    account: user.account,
  };
}

async function hydrateAuthUser(user: AuthUser): Promise<AuthUser> {
  const nextProfileSlots = normalizeProfileSlots(user.profileSlots);
  const nextActiveProfileSlot = user.activeProfileSlot ?? PROFILE_SLOT_OPTIONS[0];
  const nextAccount = normalizeAccount(user.account);
  const nextHasCompletedProfileSetup = user.hasCompletedProfileSetup ?? false;

  const needsUpdate =
    user.profileSlots === undefined ||
    user.profileSlots?.A?.tableId === undefined ||
    user.activeProfileSlot === undefined ||
    user.account === undefined ||
    user.account.unlocked?.backgrounds === undefined ||
    user.account.unlocked?.tables === undefined ||
    user.hasCompletedProfileSetup === undefined;

  if (!needsUpdate) {
    return user;
  }

  const hydratedUser: AuthUser = {
    ...user,
    profileSlots: nextProfileSlots,
    activeProfileSlot: nextActiveProfileSlot,
    account: nextAccount,
    hasCompletedProfileSetup: nextHasCompletedProfileSetup,
    updatedAt: Date.now(),
  };

  await authStore.patch(user.id, {
        profileSlots: hydratedUser.profileSlots,
        activeProfileSlot: hydratedUser.activeProfileSlot,
        account: hydratedUser.account,
        hasCompletedProfileSetup: hydratedUser.hasCompletedProfileSetup,
        updatedAt: hydratedUser.updatedAt,
      });

  return hydratedUser;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(`${raw}:${APP_SECRET}`).digest("hex");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) {
    return false;
  }
  const [salt, digestHex] = parts;
  const digest = scryptSync(password, salt, 64);
  const expected = Buffer.from(digestHex, "hex");
  if (expected.length !== digest.length) {
    return false;
  }
  return timingSafeEqual(digest, expected);
}

app.post("/auth/register", async (req, res) => {
  try {
    const parsed = registerSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const playerName = parsed.playerName.trim();
    const now = Date.now();

    const existingUser = await authStore.findByEmail(email);
    if (existingUser) {
      res.status(409).json({ ok: false, error: "Sis el. pastas jau uzregistruotas" });
      return;
    }

    const starterAccount = createDefaultAccount();
    starterAccount.points = REGISTRATION_STARTER_POINTS;

    const nextUser: AuthUser = {
      id: randomBytes(16).toString("hex"),
      email,
      playerName,
      passwordHash: hashPassword(parsed.password),
      hasCompletedProfileSetup: false,
      activeProfileSlot: PROFILE_SLOT_OPTIONS[0],
      profileSlots: createDefaultProfileSlots(),
      account: starterAccount,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await authStore.insert(nextUser);

    res.json({
      ok: true,
      message: "Registracija sekminga. Dabar galite prisijungti.",
      userId: nextUser.id,
      playerName,
      registeredAt: nextUser.createdAt,
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const storedUser = await authStore.findByEmail(email);

    if (!storedUser || !verifyPassword(parsed.password, storedUser.passwordHash)) {
      res.status(401).json({ ok: false, error: "Neteisingas el. pastas arba slaptazodis" });
      return;
    }

    const user = await hydrateAuthUser(storedUser);

    res.json({
      ok: true,
      ...toBootstrapPayload({
        ...user,
      }),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/auth/bootstrap", async (req, res) => {
  try {
    const parsed = bootstrapSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const storedUser = await authStore.findByEmail(email);

    if (!storedUser) {
      res.status(404).json({ ok: false, error: "Vartotojas nerastas" });
      return;
    }

    const user = await hydrateAuthUser(storedUser);

    res.json({ ok: true, ...toBootstrapPayload(user) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/auth/profile", async (req, res) => {
  try {
    const parsed = saveProfileSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const storedUser = await authStore.findByEmail(email);

    if (!storedUser) {
      res.status(404).json({ ok: false, error: "Vartotojas nerastas" });
      return;
    }

    const user = await hydrateAuthUser(storedUser);
    const activeProfileSlot = parsed.activeProfileSlot;
    const nextProfile = normalizeProfile({ ...parsed.profile, profileSlot: activeProfileSlot }, activeProfileSlot);
    const nextProfileSlots: ProfileSlotMap = {
      ...user.profileSlots,
      [activeProfileSlot]: nextProfile,
    };
    const hasCompletedProfileSetup = parsed.completeSetup ? true : user.hasCompletedProfileSetup;
    const updatedAt = Date.now();

    await authStore.patch(user.id, {
          profileSlots: nextProfileSlots,
          activeProfileSlot,
          hasCompletedProfileSetup,
          updatedAt,
        });

    res.json({
      ok: true,
      ...toBootstrapPayload({
        ...user,
        profileSlots: nextProfileSlots,
        activeProfileSlot,
        hasCompletedProfileSetup,
        updatedAt,
      }),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  try {
    const parsed = forgotPasswordSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const user = await authStore.findByEmail(email);

    let previewResetLink: string | undefined;

    if (user) {
      const tokenRaw = randomBytes(32).toString("hex");
      const tokenHash = hashToken(tokenRaw);
      await authStore.patch(user.id, {
            resetTokenHash: tokenHash,
            resetTokenExpiresAt: Date.now() + 1000 * 60 * 30,
            updatedAt: Date.now(),
          });

      const resetLink = `${CLIENT_URL}?resetToken=${tokenRaw}`;
      previewResetLink = resetLink;
    }

    res.json({
      ok: true,
      message: "Jei toks el. pastas egzistuoja, issiunteme slaptazodzio atstatymo nuoroda.",
      previewResetLink,
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  try {
    const parsed = resetPasswordSchema.parse(req.body);
    const tokenHash = hashToken(parsed.token);
    const now = Date.now();

    const user = await authStore.findByResetToken(tokenHash, now);

    if (!user) {
      res.status(400).json({ ok: false, error: "Neteisingas arba nebegaliojantis slaptazodzio atstatymo tokenas" });
      return;
    }

    await authStore.patch(user.id, {
          passwordHash: hashPassword(parsed.password),
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          updatedAt: now,
        });

    res.json({ ok: true, message: "Slaptazodis sekmingai atnaujintas" });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  },
});

const engine = new GameEngine();

// Po kiekvieno match'o rezultatai (taskai, W/L, zaidimu skaicius) irasomi
// i auth DB, kad isliktu tarp sesiju ir matytusi Marketplace/profilyje.
engine.setMatchRewardsListener((rewards) => {
  for (const entry of rewards) {
    const authUserId = entry.authUserId;
    if (!authUserId) {
      continue;
    }
    void (async () => {
      const storedUser = await authStore.findById(authUserId);
      if (!storedUser) {
        return;
      }
      const user = await hydrateAuthUser(storedUser);
      const account = normalizeAccount(user.account);
      account.points += entry.reward;
      account.gamesPlayed += 1;
      if (entry.won) {
        account.gamesWon += 1;
      } else {
        account.gamesLost += 1;
      }
      await authStore.patch(user.id, { account, updatedAt: Date.now() });
    })().catch((error) => {
      console.error("Nepavyko irasyti match rewards:", error);
    });
  }
});

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(24),
  authUserId: z.string().trim().regex(AUTH_USER_ID_REGEX).optional(),
  profile: profileSchema.optional(),
});

const joinRoomSchema = z.object({
  roomCode: z.string().trim().min(2).max(12),
  name: z.string().trim().min(1).max(24),
  authUserId: z.string().trim().regex(AUTH_USER_ID_REGEX).optional(),
  existingPlayerId: z.string().uuid().optional(),
  profile: profileSchema.optional(),
});

const updateProfileSchema = z.object({
  profile: profileSchema,
});

const purchaseItemSchema = z.object({
  itemType: z.enum(["avatar", "hat", "skin", "effect", "background", "table"]),
  itemId: z.string().trim().min(1),
});

function isValidShopItem(type: ShopItemType, itemId: ShopItemId): boolean {
  if (type === "avatar") {
    return AVATAR_OPTIONS.includes(itemId as PlayerProfile["avatarId"]);
  }
  if (type === "hat") {
    return HAT_OPTIONS.includes(itemId as PlayerProfile["hatId"]);
  }
  if (type === "skin") {
    return SKIN_OPTIONS.includes(itemId as PlayerProfile["skinId"]);
  }
  if (type === "effect") {
    return EFFECT_OPTIONS.includes(itemId as PlayerProfile["effectId"]);
  }
  if (type === "table") {
    return TABLE_OPTIONS.includes(itemId as PlayerProfile["tableId"]);
  }
  return CARD_BACKGROUND_OPTIONS.includes(itemId as PlayerProfile["cardBackgroundId"]);
}

function resolveItemCost(type: ShopItemType, itemId: ShopItemId): number {
  if (type === "avatar") {
    const override = AVATAR_PRICE_OVERRIDES[itemId as PlayerProfile["avatarId"]];
    if (typeof override === "number") {
      return override;
    }
    return RARITY_PRICES[AVATAR_RARITY[itemId as PlayerProfile["avatarId"]]];
  }
  if (type === "hat") {
    return RARITY_PRICES[HAT_RARITY[itemId as PlayerProfile["hatId"]]];
  }
  if (type === "skin") {
    return RARITY_PRICES[SKIN_RARITY[itemId as PlayerProfile["skinId"]]];
  }
  if (type === "effect") {
    return RARITY_PRICES[EFFECT_RARITY[itemId as PlayerProfile["effectId"]]];
  }
  if (type === "table") {
    return RARITY_PRICES[TABLE_RARITY[itemId as PlayerProfile["tableId"]]];
  }
  return RARITY_PRICES[CARD_BACKGROUND_RARITY[itemId as PlayerProfile["cardBackgroundId"]]];
}

function isItemUnlocked(account: PlayerAccountState, type: ShopItemType, itemId: ShopItemId): boolean {
  if (type === "avatar") {
    return account.unlocked.avatars.includes(itemId as PlayerProfile["avatarId"]);
  }
  if (type === "hat") {
    return account.unlocked.hats.includes(itemId as PlayerProfile["hatId"]);
  }
  if (type === "skin") {
    return account.unlocked.skins.includes(itemId as PlayerProfile["skinId"]);
  }
  if (type === "effect") {
    return account.unlocked.effects.includes(itemId as PlayerProfile["effectId"]);
  }
  if (type === "table") {
    return account.unlocked.tables.includes(itemId as PlayerProfile["tableId"]);
  }
  return account.unlocked.backgrounds.includes(itemId as PlayerProfile["cardBackgroundId"]);
}

function unlockItem(account: PlayerAccountState, type: ShopItemType, itemId: ShopItemId): void {
  if (type === "avatar") {
    account.unlocked.avatars.push(itemId as PlayerProfile["avatarId"]);
    return;
  }
  if (type === "hat") {
    account.unlocked.hats.push(itemId as PlayerProfile["hatId"]);
    return;
  }
  if (type === "skin") {
    account.unlocked.skins.push(itemId as PlayerProfile["skinId"]);
    return;
  }
  if (type === "effect") {
    account.unlocked.effects.push(itemId as PlayerProfile["effectId"]);
    return;
  }
  if (type === "table") {
    account.unlocked.tables.push(itemId as PlayerProfile["tableId"]);
    return;
  }
  account.unlocked.backgrounds.push(itemId as PlayerProfile["cardBackgroundId"]);
}

app.post("/auth/purchase", async (req, res) => {
  try {
    const parsed = authPurchaseSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const itemType = parsed.itemType as ShopItemType;
    const itemId = parsed.itemId as ShopItemId;
    const storedUser = await authStore.findByEmail(email);

    if (!storedUser) {
      res.status(404).json({ ok: false, error: "Vartotojas nerastas" });
      return;
    }

    const user = await hydrateAuthUser(storedUser);
    if (!isValidShopItem(itemType, itemId)) {
      res.status(400).json({ ok: false, error: "Neteisingas shop elementas" });
      return;
    }

    const account = normalizeAccount(user.account);
    if (isItemUnlocked(account, itemType, itemId)) {
      res.status(409).json({ ok: false, error: "Elementas jau atrakintas" });
      return;
    }

    const cost = resolveItemCost(itemType, itemId);
    if (account.points < cost) {
      res.status(400).json({ ok: false, error: "Truksta tasku" });
      return;
    }

    account.points -= cost;
    unlockItem(account, itemType, itemId);
    const updatedAt = Date.now();

    await authStore.patch(user.id, {
          account,
          updatedAt,
        });

    res.json({ ok: true, account });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

const adminGrantPointsSchema = z.object({
  email: z.string().trim().email(),
  points: z.number().int().min(-1_000_000).max(1_000_000),
});

function isValidAdminSecret(provided: string): boolean {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(APP_SECRET).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

app.post("/admin/grant-points", async (req, res) => {
  const providedSecret = req.header("x-app-secret") ?? "";
  if (!providedSecret || !isValidAdminSecret(providedSecret)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const parsed = adminGrantPointsSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const storedUser = await authStore.findByEmail(email);

    if (!storedUser) {
      res.status(404).json({ ok: false, error: "Vartotojas nerastas" });
      return;
    }

    const user = await hydrateAuthUser(storedUser);
    const account = normalizeAccount(user.account);
    account.points = Math.max(0, account.points + parsed.points);

    await authStore.patch(user.id, {
          account,
          updatedAt: Date.now(),
        });

    res.json({ ok: true, email, points: account.points });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

const playerCardInfoSchema = z.object({
  targetPlayerId: z.string().trim().uuid(),
});

function emitRoomState(roomCode: string): void {
  const socketIds = engine.getRoomPlayerSocketIds(roomCode);
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      continue;
    }
    const playerId = socket.data.playerId as string;
    const payload = engine.getClientState(roomCode, playerId);
    socket.emit("state_sync", payload);
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", (payload: unknown, ack) => {
    try {
      const parsed = createRoomSchema.parse(payload);
      const authUser = parsed.authUserId ? authStore.findById(parsed.authUserId) : null;
      Promise.resolve(authUser)
        .then((resolvedAuthUser) => {
          const effectiveName = resolvedAuthUser?.playerName?.trim() || parsed.name;
          const { roomCode, playerId } = engine.createRoom(effectiveName, socket.id, parsed.profile, {
            authUserId: resolvedAuthUser?.id ?? parsed.authUserId ?? null,
            registeredAt: resolvedAuthUser?.createdAt,
          });
          socket.data.roomCode = roomCode;
          socket.data.playerId = playerId;
          socket.join(roomCode);
          emitRoomState(roomCode);
          ack?.({ ok: true, roomCode, playerId });
        })
        .catch((error) => {
          ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
        });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("join_room", (payload: unknown, ack) => {
    try {
      const parsed = joinRoomSchema.parse(payload);
      const roomCode = parsed.roomCode.trim().toUpperCase();
      const existingPlayerId = parsed.existingPlayerId;
      const authUser = parsed.authUserId ? authStore.findById(parsed.authUserId) : null;
      Promise.resolve(authUser)
        .then((resolvedAuthUser) => {
          let playerId = existingPlayerId;
          if (playerId) {
            engine.updateSocket(roomCode, playerId, socket.id);
          } else {
            const effectiveName = resolvedAuthUser?.playerName?.trim() || parsed.name;
            const joined = engine.joinRoom(roomCode, effectiveName, socket.id, parsed.profile, {
              authUserId: resolvedAuthUser?.id ?? parsed.authUserId ?? null,
              registeredAt: resolvedAuthUser?.createdAt,
            });
            playerId = joined.playerId;
          }

          socket.data.roomCode = roomCode;
          socket.data.playerId = playerId;
          socket.join(roomCode);
          emitRoomState(roomCode);
          ack?.({ ok: true, roomCode, playerId });
        })
        .catch((error) => {
          ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
        });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("start_game", (_payload, ack) => {
    try {
      const roomCode = socket.data.roomCode as string;
      engine.startGame(roomCode);
      emitRoomState(roomCode);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("take_turn_action", ({ action }: { action: TurnAction }, ack) => {
    try {
      const roomCode = socket.data.roomCode as string;
      const playerId = socket.data.playerId as string;
      engine.applyTurnAction(roomCode, playerId, action);
      emitRoomState(roomCode);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("accuse_fasiolas", ({ accusedPlayerId }: { accusedPlayerId: string }, ack) => {
    try {
      const roomCode = socket.data.roomCode as string;
      const playerId = socket.data.playerId as string;
      engine.accuseFasiolas(roomCode, playerId, accusedPlayerId);
      emitRoomState(roomCode);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("resolve_fasiolas", ({ cardIndex }: { cardIndex: number }, ack) => {
    try {
      const roomCode = socket.data.roomCode as string;
      const playerId = socket.data.playerId as string;
      engine.resolveFasiolasContribution(roomCode, playerId, cardIndex);
      emitRoomState(roomCode);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("update_profile", (payload: unknown, ack) => {
    try {
      const parsed = updateProfileSchema.parse(payload);
      const roomCode = socket.data.roomCode as string;
      const playerId = socket.data.playerId as string;
      const profile = parsed.profile as PlayerProfile;
      engine.updateProfile(roomCode, playerId, profile);
      emitRoomState(roomCode);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("get_account", (_payload, ack) => {
    try {
      const playerId = socket.data.playerId as string;
      const account = engine.getAccountState(playerId);
      ack?.({ ok: true, account });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("get_shop_catalog", (_payload, ack) => {
    try {
      const catalog = engine.getShopCatalog();
      ack?.({ ok: true, catalog });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("purchase_shop_item", (payload: unknown, ack) => {
    try {
      const parsed = purchaseItemSchema.parse(payload);
      const playerId = socket.data.playerId as string;
      const account = engine.purchaseShopItem(
        playerId,
        parsed.itemType as ShopItemType,
        parsed.itemId as ShopItemId,
      );
      const catalog = engine.getShopCatalog();
      ack?.({ ok: true, account, catalog });

      const roomCode = socket.data.roomCode as string;
      if (roomCode) {
        emitRoomState(roomCode);
      }
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("get_player_card_info", async (payload: unknown, ack) => {
    try {
      const { targetPlayerId } = playerCardInfoSchema.parse(payload);
      const roomCode = socket.data.roomCode as string;
      const info = engine.getPlayerCardInfo(roomCode, targetPlayerId);
      let responseInfo: PlayerCardInfo = info;

      // Prefer exact auth user linkage when available.
      try {
        const authUserId = engine.getPlayerAuthUserId(roomCode, targetPlayerId);
        const authUser = authUserId ? await authStore.findById(authUserId) : null;
        if (authUser?.createdAt) {
          responseInfo = { ...info, registeredAt: authUser.createdAt };
        }
      } catch {
        // ignore lookup failure
      }

      ack?.({ ok: true, ...responseInfo });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });
});

const port = Number(process.env.PORT || 3001);
authStore
  .init()
  .then(() => {
    httpServer.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("Nepavyko inicializuoti auth store:", error);
    process.exit(1);
  });
