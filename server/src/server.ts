import cors from "cors";
import express from "express";
import { createServer } from "node:http";
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
  type ShopItemId,
  type ShopItemType,
  type TurnAction,
} from "../../shared/src/types";
import { GameEngine } from "./gameEngine";

const app = express();
app.use(cors({ origin: "*" }));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
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
  profile: profileSchema.optional(),
});

const joinRoomSchema = z.object({
  roomCode: z.string().trim().min(2).max(12),
  name: z.string().trim().min(1).max(24),
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
      const { roomCode, playerId } = engine.createRoom(parsed.name, socket.id, parsed.profile);
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      socket.join(roomCode);
      emitRoomState(roomCode);
      ack?.({ ok: true, roomCode, playerId });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("join_room", (payload: unknown, ack) => {
    try {
      const parsed = joinRoomSchema.parse(payload);
      const roomCode = parsed.roomCode.trim().toUpperCase();
      const existingPlayerId = parsed.existingPlayerId;
      let playerId = existingPlayerId;
      if (playerId) {
        engine.updateSocket(roomCode, playerId, socket.id);
      } else {
        const joined = engine.joinRoom(roomCode, parsed.name, socket.id, parsed.profile);
        playerId = joined.playerId;
      }

      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      socket.join(roomCode);
      emitRoomState(roomCode);
      ack?.({ ok: true, roomCode, playerId });
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

  socket.on("auto_play_dealing", (_payload, ack) => {
    try {
      const roomCode = socket.data.roomCode as string;
      const playerId = socket.data.playerId as string;
      engine.autoPlayDealingPhase(roomCode, playerId);
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
});

const port = Number(process.env.PORT || 3001);
httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on ${port}`);
});
