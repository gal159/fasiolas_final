import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { TurnAction } from "../../shared/src/types";
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
  socket.on("create_room", ({ name }: { name: string }, ack) => {
    try {
      const { roomCode, playerId } = engine.createRoom(name, socket.id);
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      socket.join(roomCode);
      emitRoomState(roomCode);
      ack?.({ ok: true, roomCode, playerId });
    } catch (error) {
      ack?.({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  socket.on("join_room", ({ roomCode, name, existingPlayerId }: { roomCode: string; name: string; existingPlayerId?: string }, ack) => {
    try {
      let playerId = existingPlayerId;
      if (playerId) {
        engine.updateSocket(roomCode, playerId, socket.id);
      } else {
        const joined = engine.joinRoom(roomCode, name, socket.id);
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
});

const port = Number(process.env.PORT || 3001);
httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on ${port}`);
});
