import "dotenv/config";
import cors from "cors";
import express from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import Datastore from "nedb-promises";
import { Server } from "socket.io";
import { z } from "zod";
import {
  AVATAR_OPTIONS,
  EFFECT_OPTIONS,
  HAT_OPTIONS,
  PROFILE_COLOR_OPTIONS,
  PROFILE_SLOT_OPTIONS,
  SKIN_OPTIONS,
  type PlayerProfile,
  type PlayerCardInfo,
  type ShopItemId,
  type ShopItemType,
  type TurnAction,
} from "../../shared/src/types";
import { GameEngine } from "./gameEngine";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
const APP_SECRET = process.env.APP_SECRET ?? "dev-secret-change-me";

const AUTH_DB_PATH = resolve(process.cwd(), "data", "auth-users.db");

type AuthUser = {
  id: string;
  email: string;
  playerName: string;
  passwordHash: string;
  resetTokenHash: string | null;
  resetTokenExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

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

const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(256),
  password: z.string().min(8).max(128),
});

const authUsersDb = Datastore.create({
  filename: AUTH_DB_PATH,
  autoload: true,
}) as Datastore<AuthUser>;

void authUsersDb.ensureIndex({ fieldName: "email", unique: true });

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

    const existingUser = await authUsersDb.findOne({ email });
    if (existingUser) {
      res.status(409).json({ ok: false, error: "Sis el. pastas jau uzregistruotas" });
      return;
    }

    const nextUser: AuthUser = {
      id: randomBytes(16).toString("hex"),
      email,
      playerName,
      passwordHash: hashPassword(parsed.password),
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await authUsersDb.insert(nextUser);

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
    const user = await authUsersDb.findOne({ email });

    if (!user || !verifyPassword(parsed.password, user.passwordHash)) {
      res.status(401).json({ ok: false, error: "Neteisingas el. pastas arba slaptazodis" });
      return;
    }

    res.json({
      ok: true,
      email: user.email,
      userId: user.id,
      playerName: user.playerName,
      registeredAt: user.createdAt,
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  try {
    const parsed = forgotPasswordSchema.parse(req.body);
    const email = normalizeEmail(parsed.email);
    const user = await authUsersDb.findOne({ email });

    let previewResetLink: string | undefined;

    if (user) {
      const tokenRaw = randomBytes(32).toString("hex");
      const tokenHash = hashToken(tokenRaw);
      await authUsersDb.update(
        { id: user.id },
        {
          $set: {
            resetTokenHash: tokenHash,
            resetTokenExpiresAt: Date.now() + 1000 * 60 * 30,
            updatedAt: Date.now(),
          },
        },
      );

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

    const user = await authUsersDb.findOne({
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: { $gte: now },
    });

    if (!user) {
      res.status(400).json({ ok: false, error: "Neteisingas arba nebegaliojantis slaptazodzio atstatymo tokenas" });
      return;
    }

    await authUsersDb.update(
      { id: user.id },
      {
        $set: {
          passwordHash: hashPassword(parsed.password),
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          updatedAt: now,
        },
      },
    );

    res.json({ ok: true, message: "Slaptazodis sekmingai atnaujintas" });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const engine = new GameEngine();

const profileSchema = z.object({
  baseColor: z.enum(PROFILE_COLOR_OPTIONS),
  avatarId: z.enum(AVATAR_OPTIONS),
  hatId: z.enum(HAT_OPTIONS),
  skinId: z.enum(SKIN_OPTIONS),
  effectId: z.enum(EFFECT_OPTIONS),
  profileSlot: z.enum(PROFILE_SLOT_OPTIONS),
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
  itemType: z.enum(["avatar", "hat", "skin", "effect"]),
  itemId: z.string().trim().min(1),
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
      const authUser = parsed.authUserId ? authUsersDb.findOne({ id: parsed.authUserId }) : null;
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
      const authUser = parsed.authUserId ? authUsersDb.findOne({ id: parsed.authUserId }) : null;
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
        const authUser = authUserId ? await authUsersDb.findOne({ id: authUserId }) : null;
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
httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on ${port}`);
});
