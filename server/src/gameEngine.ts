import { randomUUID } from "node:crypto";
import type {
  Card,
  ClientStatePayload,
  DealingAction,
  PendingFasiolasState,
  PlayingAction,
  PublicTableState,
  Rank,
  Suit,
  TurnAction,
} from "../../shared/src/types";

type InternalPlayer = {
  id: string;
  name: string;
  cards: Card[];
  socketId: string;
};

type LastActionRecord = {
  actorPlayerId: string;
  suspiciousType:
    | "INVALID_PLUS_ONE_TO_OTHER"
    | "SHOULD_HAVE_PLACED_TO_OTHER"
    | "SHOULD_HAVE_MOVED_TOP_TO_OTHER"
    | null;
};

type GameRoom = {
  code: string;
  players: InternalPlayer[];
  phase: PublicTableState["phase"];
  centerDeck: Card[];
  revealedDrawCard: Card | null;
  tableStack: Card[];
  currentTurnPlayerId: string | null;
  lastNonSpadeDrawnSuit: Suit | null;
  trumpSuit: Suit | null;
  winnerPlayerIds: string[];
  loserPlayerId: string | null;
  dealerLog: string[];
  pendingFasiolas: PendingFasiolasState | null;
  pendingFasiolasCards: Map<string, Card>;
  lastAction: LastActionRecord | null;
};

const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_ORDER: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const PLUS_ONE_MAP: Partial<Record<Rank, Rank>> = {
  "2": "3",
  Q: "K",
  A: "2",
};

function shuffleDeck(deck: Card[]): Card[] {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank });
    }
  }
  return shuffleDeck(cards);
}

function canApplyPlusOne(baseTop: Card | null, cardToPlace: Card): boolean {
  if (!baseTop) {
    return true;
  }
  const expected = PLUS_ONE_MAP[baseTop.rank];
  return expected === cardToPlace.rank;
}

function isHigherSameSuit(base: Card, candidate: Card): boolean {
  return base.suit === candidate.suit && RANK_ORDER[candidate.rank] > RANK_ORDER[base.rank];
}

export class GameEngine {
  private readonly rooms = new Map<string, GameRoom>();

  public createRoom(hostName: string, socketId: string): { roomCode: string; playerId: string } {
    const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const playerId = randomUUID();
    this.rooms.set(roomCode, {
      code: roomCode,
      players: [{ id: playerId, name: hostName, cards: [], socketId }],
      phase: "LOBBY",
      centerDeck: [],
      revealedDrawCard: null,
      tableStack: [],
      currentTurnPlayerId: null,
      lastNonSpadeDrawnSuit: null,
      trumpSuit: null,
      winnerPlayerIds: [],
      loserPlayerId: null,
      dealerLog: [],
      pendingFasiolas: null,
      pendingFasiolasCards: new Map(),
      lastAction: null,
    });
    return { roomCode, playerId };
  }

  public joinRoom(roomCode: string, name: string, socketId: string): { playerId: string } {
    const room = this.getRoomOrThrow(roomCode);
    if (room.players.length >= 8) {
      throw new Error("Room is full");
    }
    if (room.phase !== "LOBBY") {
      throw new Error("Game already started");
    }
    const playerId = randomUUID();
    room.players.push({ id: playerId, name, cards: [], socketId });
    return { playerId };
  }

  public startGame(roomCode: string): void {
    const room = this.getRoomOrThrow(roomCode);
    if (room.players.length < 2) {
      throw new Error("Need at least 2 players");
    }
    room.phase = "DEALING";
    room.centerDeck = createDeck();
    room.revealedDrawCard = null;
    room.tableStack = [];
    room.trumpSuit = null;
    room.lastNonSpadeDrawnSuit = null;
    room.winnerPlayerIds = [];
    room.loserPlayerId = null;
    room.dealerLog = ["Started dealing phase"];
    room.pendingFasiolas = null;
    room.pendingFasiolasCards = new Map();
    room.lastAction = null;

    for (const p of room.players) {
      p.cards = [];
    }

    for (const p of room.players) {
      const card = room.centerDeck.pop();
      if (!card) {
        break;
      }
      p.cards.push(card);
    }

    room.currentTurnPlayerId = room.players[0]?.id ?? null;
  }

  public applyTurnAction(roomCode: string, actorPlayerId: string, action: TurnAction): void {
    const room = this.getRoomOrThrow(roomCode);
    if (room.currentTurnPlayerId !== actorPlayerId) {
      throw new Error("Not your turn");
    }

    if (room.phase === "DEALING") {
      this.applyDealingAction(room, actorPlayerId, action as DealingAction);
      this.tryTransitionToPlaying(room);
      return;
    }

    if (room.phase === "PLAYING") {
      this.applyPlayingAction(room, actorPlayerId, action as PlayingAction);
      this.checkPlayEnd(room);
      return;
    }

    throw new Error("Game is not active");
  }

  public accuseFasiolas(roomCode: string, callerPlayerId: string, accusedPlayerId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    if (room.phase !== "DEALING") {
      throw new Error("Fasiolas allowed only in dealing phase");
    }
    if (callerPlayerId === accusedPlayerId) {
      throw new Error("Cannot accuse yourself");
    }
    if (!room.lastAction || room.lastAction.actorPlayerId !== accusedPlayerId) {
      throw new Error("No punishable recent action by this player");
    }
    if (!room.lastAction.suspiciousType) {
      throw new Error("No fasiolas violation detected");
    }
    if (room.pendingFasiolas) {
      throw new Error("Fasiolas already pending");
    }

    const requiredFromPlayerIds = room.players
      .map((p) => p.id)
      .filter((id) => id !== accusedPlayerId);

    room.pendingFasiolas = {
      accusedPlayerId,
      requiredFromPlayerIds,
      contributedFromPlayerIds: [],
    };
    room.pendingFasiolasCards = new Map();
    room.dealerLog.push("Fasiolas activated");
  }

  public resolveFasiolasContribution(roomCode: string, fromPlayerId: string, cardIndex: number): void {
    const room = this.getRoomOrThrow(roomCode);
    const pending = room.pendingFasiolas;
    if (!pending) {
      throw new Error("No pending fasiolas");
    }
    if (!pending.requiredFromPlayerIds.includes(fromPlayerId)) {
      throw new Error("This player is not required to contribute");
    }
    if (pending.contributedFromPlayerIds.includes(fromPlayerId)) {
      throw new Error("Already contributed");
    }

    const fromPlayer = room.players.find((p) => p.id === fromPlayerId);
    if (!fromPlayer) {
      throw new Error("Contributor not found");
    }
    if (cardIndex < 0 || cardIndex >= fromPlayer.cards.length) {
      throw new Error("Invalid card index");
    }

    const isTopCardIndex = fromPlayer.cards.length - 1;
    if (cardIndex === isTopCardIndex) {
      throw new Error("Must contribute a non-top card");
    }

    const [card] = fromPlayer.cards.splice(cardIndex, 1);
    room.pendingFasiolasCards.set(fromPlayerId, card);
    pending.contributedFromPlayerIds.push(fromPlayerId);

    if (pending.contributedFromPlayerIds.length === pending.requiredFromPlayerIds.length) {
      const accused = room.players.find((p) => p.id === pending.accusedPlayerId);
      if (!accused) {
        throw new Error("Accused player not found");
      }

      for (const contributorId of pending.requiredFromPlayerIds) {
        const c = room.pendingFasiolasCards.get(contributorId);
        if (c) {
          accused.cards.unshift(c);
        }
      }

      room.pendingFasiolas = null;
      room.pendingFasiolasCards = new Map();
      room.dealerLog.push("Fasiolas resolved and penalty cards moved");
    }
  }

  public updateSocket(roomCode: string, playerId: string, socketId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error("Player not found");
    }
    player.socketId = socketId;
  }

  public getClientState(roomCode: string, viewerPlayerId: string): ClientStatePayload {
    const room = this.getRoomOrThrow(roomCode);
    const viewer = room.players.find((p) => p.id === viewerPlayerId);
    if (!viewer) {
      throw new Error("Viewer not in room");
    }

    return {
      yourPlayerId: viewer.id,
      yourHand: [...viewer.cards],
      state: {
        phase: room.phase,
        roomCode: room.code,
        currentTurnPlayerId: room.currentTurnPlayerId,
        players: room.players.map((p) => ({
          id: p.id,
          name: p.name,
          cardCount: p.cards.length,
          topCard: p.cards[p.cards.length - 1] ?? null,
        })),
        centerDeckCount: room.centerDeck.length,
        revealedDrawCard: room.revealedDrawCard,
        tableStack: [...room.tableStack],
        trumpSuit: room.trumpSuit,
        dealerLog: [...room.dealerLog].slice(-8),
        winnerPlayerIds: [...room.winnerPlayerIds],
        loserPlayerId: room.loserPlayerId,
        pendingFasiolas: room.pendingFasiolas,
      },
    };
  }

  public getRoomPlayerSocketIds(roomCode: string): string[] {
    const room = this.getRoomOrThrow(roomCode);
    return room.players.map((p) => p.socketId);
  }

  private applyDealingAction(room: GameRoom, actorPlayerId: string, action: DealingAction): void {
    const actor = this.getPlayerOrThrow(room, actorPlayerId);

    if (room.revealedDrawCard && action.type !== "PLACE_REVEALED") {
      throw new Error("First place the revealed card from center");
    }

    if (action.type === "MOVE_VISIBLE_CARD") {
      const target = this.getPlayerOrThrow(room, action.toPlayerId);
      const movingCard = actor.cards[actor.cards.length - 1];
      if (!movingCard) {
        throw new Error("No card to move");
      }

      const targetTop = target.cards[target.cards.length - 1] ?? null;
      const legalPlusOne = canApplyPlusOne(targetTop, movingCard);

      actor.cards.pop();
      target.cards.push(movingCard);

      room.lastAction = {
        actorPlayerId,
        suspiciousType: legalPlusOne ? null : "INVALID_PLUS_ONE_TO_OTHER",
      };
      room.dealerLog.push(`${actor.name} moved card to ${target.name}`);
      return;
    }

    if (action.type === "DRAW_REVEAL") {
      const actorTop = actor.cards[actor.cards.length - 1] ?? null;
      const couldMoveTopToOther =
        actorTop !== null &&
        room.players
          .filter((p) => p.id !== actorPlayerId)
          .some((p) => canApplyPlusOne(p.cards[p.cards.length - 1] ?? null, actorTop));

      const drawn = room.centerDeck.pop();
      if (!drawn) {
        throw new Error("Center deck is empty");
      }
      room.revealedDrawCard = drawn;
      if (drawn.suit !== "S") {
        room.lastNonSpadeDrawnSuit = drawn.suit;
      }

      room.lastAction = {
        actorPlayerId,
        suspiciousType: couldMoveTopToOther ? "SHOULD_HAVE_MOVED_TOP_TO_OTHER" : null,
      };
      room.dealerLog.push(`${actor.name} revealed center card ${drawn.rank}${drawn.suit}`);
      return;
    }

    if (action.type === "PLACE_REVEALED") {
      const drawn = room.revealedDrawCard;
      if (!drawn) {
        throw new Error("No revealed card to place");
      }

      const target = this.getPlayerOrThrow(room, action.toPlayerId);
      const targetTop = target.cards[target.cards.length - 1] ?? null;
      const legalPlusOne = canApplyPlusOne(targetTop, drawn);

      if (target.id === actorPlayerId) {
        const canPlaceToOthers = room.players
          .filter((p) => p.id !== actorPlayerId)
          .some((p) => canApplyPlusOne(p.cards[p.cards.length - 1] ?? null, drawn));

        actor.cards.push(drawn);
        room.revealedDrawCard = null;
        room.lastAction = {
          actorPlayerId,
          suspiciousType: canPlaceToOthers ? "SHOULD_HAVE_PLACED_TO_OTHER" : null,
        };

        if (!canApplyPlusOne(actor.cards[actor.cards.length - 2] ?? null, drawn)) {
          this.advanceTurn(room);
        }
      } else {
        target.cards.push(drawn);
        room.revealedDrawCard = null;
        room.lastAction = {
          actorPlayerId,
          suspiciousType: legalPlusOne ? null : "INVALID_PLUS_ONE_TO_OTHER",
        };
      }

      room.dealerLog.push(`${actor.name} placed revealed card to ${target.name}`);
      return;
    }

    if (action.type === "END_TURN") {
      this.advanceTurn(room);
      room.lastAction = { actorPlayerId, suspiciousType: null };
      return;
    }

    throw new Error("Unsupported dealing action");
  }

  private applyPlayingAction(room: GameRoom, actorPlayerId: string, action: PlayingAction): void {
    const actor = this.getPlayerOrThrow(room, actorPlayerId);

    if (action.type === "PLAY_CARD") {
      if (action.cardIndex < 0 || action.cardIndex >= actor.cards.length) {
        throw new Error("Invalid card index");
      }

      const candidate = actor.cards[action.cardIndex];
      const topTable = room.tableStack[room.tableStack.length - 1] ?? null;

      if (!topTable) {
        actor.cards.splice(action.cardIndex, 1);
        room.tableStack.push(candidate);
        this.afterPlayCard(room, actorPlayerId);
        return;
      }

      const topIsSpade = topTable.suit === "S";
      const topIsTrump = room.trumpSuit !== null && topTable.suit === room.trumpSuit;

      let legal = false;
      if (topIsSpade) {
        legal = candidate.suit === "S" && isHigherSameSuit(topTable, candidate);
      } else if (topIsTrump && room.trumpSuit) {
        legal = candidate.suit === room.trumpSuit && isHigherSameSuit(topTable, candidate);
      } else {
        legal = isHigherSameSuit(topTable, candidate) || (room.trumpSuit !== null && candidate.suit === room.trumpSuit);
      }

      if (!legal) {
        throw new Error("Card does not match playing rules");
      }

      actor.cards.splice(action.cardIndex, 1);
      room.tableStack.push(candidate);
      this.afterPlayCard(room, actorPlayerId);
      return;
    }

    if (action.type === "TAKE_OLDEST") {
      const oldest = room.tableStack.shift();
      if (!oldest) {
        throw new Error("Table stack is empty");
      }
      actor.cards.push(oldest);
      this.advanceTurn(room);
      return;
    }

    throw new Error("Unsupported playing action");
  }

  private afterPlayCard(room: GameRoom, actorPlayerId: string): void {
    if (room.tableStack.length >= room.players.length) {
      room.tableStack = [];
      room.currentTurnPlayerId = actorPlayerId;
      return;
    }
    this.advanceTurn(room);
  }

  private checkPlayEnd(room: GameRoom): void {
    const playersWithCards = room.players.filter((p) => p.cards.length > 0);
    if (playersWithCards.length === 1) {
      room.phase = "FINISHED";
      room.loserPlayerId = playersWithCards[0].id;
      room.winnerPlayerIds = room.players.filter((p) => p.id !== playersWithCards[0].id).map((p) => p.id);
      room.currentTurnPlayerId = null;
    }
  }

  private tryTransitionToPlaying(room: GameRoom): void {
    if (room.centerDeck.length > 0 || room.revealedDrawCard !== null) {
      return;
    }

    room.phase = "PLAYING";
    room.trumpSuit = room.lastNonSpadeDrawnSuit;
    room.tableStack = [];

    const starter = room.players.find((p) => p.cards.some((c) => c.suit === "S" && c.rank === "9"));
    room.currentTurnPlayerId = starter?.id ?? room.players[0]?.id ?? null;
    room.dealerLog.push("Moved to playing phase");
  }

  private advanceTurn(room: GameRoom): void {
    if (!room.currentTurnPlayerId) {
      return;
    }
    const idx = room.players.findIndex((p) => p.id === room.currentTurnPlayerId);
    if (idx < 0) {
      return;
    }
    const next = (idx + 1) % room.players.length;
    room.currentTurnPlayerId = room.players[next]?.id ?? room.players[0]?.id ?? null;
  }

  private getRoomOrThrow(roomCode: string): GameRoom {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new Error("Room not found");
    }
    return room;
  }

  private getPlayerOrThrow(room: GameRoom, playerId: string): InternalPlayer {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error("Player not found");
    }
    return player;
  }
}
