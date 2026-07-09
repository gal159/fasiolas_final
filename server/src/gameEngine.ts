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
  expiresOnActionByPlayerId: string | null;
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
  finalRankingPlayerIds: string[];
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

function nextRank(rank: Rank): Rank {
  const index = RANKS.indexOf(rank);
  if (index < 0) {
    return rank;
  }
  const nextIndex = (index + 1) % RANKS.length;
  return RANKS[nextIndex];
}

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
  const expected = nextRank(baseTop.rank);
  return expected === cardToPlace.rank;
}

function isHigherSameSuit(base: Card, candidate: Card): boolean {
  return base.suit === candidate.suit && RANK_ORDER[candidate.rank] > RANK_ORDER[base.rank];
}

function canPlayOnTable(topTable: Card | null, candidate: Card, trumpSuit: Suit | null): boolean {
  if (!topTable) {
    return true;
  }

  const topIsSpade = topTable.suit === "S";
  const topIsTrump = trumpSuit !== null && topTable.suit === trumpSuit;

  if (topIsSpade) {
    return candidate.suit === "S" && isHigherSameSuit(topTable, candidate);
  }
  if (topIsTrump && trumpSuit) {
    return candidate.suit === trumpSuit && isHigherSameSuit(topTable, candidate);
  }
  return isHigherSameSuit(topTable, candidate) || (trumpSuit !== null && candidate.suit === trumpSuit);
}

export class GameEngine {
  private readonly rooms = new Map<string, GameRoom>();

  private recordLastAction(
    room: GameRoom,
    actorPlayerId: string,
    suspiciousType: LastActionRecord["suspiciousType"],
    actionType: DealingAction["type"],
  ): void {
    const previous = room.lastAction;

    if (suspiciousType !== null) {
      room.lastAction = { actorPlayerId, suspiciousType, expiresOnActionByPlayerId: null };
      return;
    }

    if (previous !== null && previous.suspiciousType !== null) {
      const shouldExpireByAction =
        previous.expiresOnActionByPlayerId === actorPlayerId &&
        (actionType === "DRAW_REVEAL" || actionType === "MOVE_VISIBLE_CARD");
      if (shouldExpireByAction) {
        room.lastAction = { actorPlayerId, suspiciousType: null, expiresOnActionByPlayerId: null };
      }
      // Keep sticky violation active until allowed expiration action happens.
      return;
    }

    room.lastAction = { actorPlayerId, suspiciousType: null, expiresOnActionByPlayerId: null };
  }

  private findPlusOneTarget(room: GameRoom, actorPlayerId: string, card: Card): string | null {
    for (const candidate of room.players) {
      if (candidate.id === actorPlayerId) {
        continue;
      }
      const candidateTop = candidate.cards[candidate.cards.length - 1] ?? null;
      if (canApplyPlusOne(candidateTop, card)) {
        return candidate.id;
      }
    }
    return null;
  }

  private findPlayableCardIndex(room: GameRoom, player: InternalPlayer): number {
    const topTable = room.tableStack[room.tableStack.length - 1] ?? null;
    for (let i = 0; i < player.cards.length; i += 1) {
      if (canPlayOnTable(topTable, player.cards[i], room.trumpSuit)) {
        return i;
      }
    }
    return -1;
  }

  private autoPlayPlayingUntilTurn(room: GameRoom, stopAtPlayerId: string): void {
    let guard = 0;
    while (room.phase === "PLAYING" && room.currentTurnPlayerId && room.currentTurnPlayerId !== stopAtPlayerId) {
      guard += 1;
      if (guard > 5000) {
        throw new Error("Auto-play table guard reached");
      }

      const currentId = room.currentTurnPlayerId;
      const currentPlayer = this.getPlayerOrThrow(room, currentId);
      const playableIdx = this.findPlayableCardIndex(room, currentPlayer);

      if (playableIdx >= 0) {
        this.applyPlayingAction(room, currentId, { type: "PLAY_CARD", cardIndex: playableIdx });
      } else {
        this.applyPlayingAction(room, currentId, { type: "TAKE_OLDEST" });
      }

      this.checkPlayEnd(room);
    }
  }

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
      finalRankingPlayerIds: [],
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
    room.finalRankingPlayerIds = [];
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

    if (room.pendingFasiolas) {
      throw new Error("Resolve fasiolas first");
    }

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

  public autoPlayDealingPhase(roomCode: string, actorPlayerId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    if (room.phase !== "DEALING") {
      throw new Error("Auto-play is allowed only in dealing phase");
    }
    if (room.pendingFasiolas) {
      throw new Error("Cannot auto-play while fasiolas is pending");
    }
    if (room.currentTurnPlayerId !== actorPlayerId) {
      throw new Error("Not your turn");
    }

    let guard = 0;
    while (room.phase === "DEALING") {
      guard += 1;
      if (guard > 5000) {
        throw new Error("Auto-play guard reached");
      }

      const currentId = room.currentTurnPlayerId;
      if (!currentId) {
        throw new Error("No current turn player");
      }
      const currentPlayer = this.getPlayerOrThrow(room, currentId);

      if (room.revealedDrawCard) {
        const targetId = this.findPlusOneTarget(room, currentId, room.revealedDrawCard) ?? currentId;
        this.applyDealingAction(room, currentId, { type: "PLACE_REVEALED", toPlayerId: targetId });
        this.tryTransitionToPlaying(room);
        continue;
      }

      const top = currentPlayer.cards[currentPlayer.cards.length - 1] ?? null;
      if (top) {
        const moveTargetId = this.findPlusOneTarget(room, currentId, top);
        if (moveTargetId) {
          this.applyDealingAction(room, currentId, { type: "MOVE_VISIBLE_CARD", toPlayerId: moveTargetId });
          this.tryTransitionToPlaying(room);
          continue;
        }
      }

      if (room.centerDeck.length > 0) {
        this.applyDealingAction(room, currentId, { type: "DRAW_REVEAL" });
        this.tryTransitionToPlaying(room);
        continue;
      }

      this.tryTransitionToPlaying(room);
    }

    room.dealerLog.push("Dealing phase auto-played");

    if (room.phase === "PLAYING") {
      this.autoPlayPlayingUntilTurn(room, actorPlayerId);
      if (room.phase === "PLAYING") {
        room.dealerLog.push("Auto-play continued to table");
      }
    }
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

    const accusedIndex = room.players.findIndex((p) => p.id === accusedPlayerId);
    if (accusedIndex < 0) {
      throw new Error("Accused player not found");
    }
    const nextIndex = (accusedIndex + 1) % room.players.length;
    room.currentTurnPlayerId = room.players[nextIndex]?.id ?? null;
    room.lastAction = null;

    room.dealerLog.push("Fasiolas activated");
  }

  public resolveFasiolasContribution(roomCode: string, fromPlayerId: string, cardIndex: number): void {
    const room = this.getRoomOrThrow(roomCode);
    const pending = room.pendingFasiolas;
    if (!pending) {
      throw new Error("No pending fasiolas");
    }
    if (fromPlayerId === pending.accusedPlayerId) {
      throw new Error("Accused player cannot contribute");
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
        finalRankingPlayerIds: [...room.finalRankingPlayerIds],
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

      this.recordLastAction(room, actorPlayerId, legalPlusOne ? null : "INVALID_PLUS_ONE_TO_OTHER", action.type);
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

      this.recordLastAction(room, actorPlayerId, couldMoveTopToOther ? "SHOULD_HAVE_MOVED_TOP_TO_OTHER" : null, action.type);
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
        const actorTopBeforePlace = actor.cards[actor.cards.length - 1] ?? null;
        const hadNoCardsBeforePlace = actor.cards.length === 0;
        const canPlaceToOthers = room.players
          .filter((p) => p.id !== actorPlayerId)
          .some((p) => canApplyPlusOne(p.cards[p.cards.length - 1] ?? null, drawn));

        actor.cards.push(drawn);
        room.revealedDrawCard = null;
        this.recordLastAction(room, actorPlayerId, canPlaceToOthers ? "SHOULD_HAVE_PLACED_TO_OTHER" : null, action.type);

        if (hadNoCardsBeforePlace || !canApplyPlusOne(actorTopBeforePlace, drawn)) {
          this.advanceTurn(room);
        }
      } else {
        target.cards.push(drawn);
        room.revealedDrawCard = null;
        this.recordLastAction(room, actorPlayerId, legalPlusOne ? null : "INVALID_PLUS_ONE_TO_OTHER", action.type);
      }

      room.dealerLog.push(`${actor.name} placed revealed card to ${target.name}`);
      return;
    }

    if (action.type === "END_TURN") {
      this.advanceTurn(room);
      this.recordLastAction(room, actorPlayerId, null, action.type);
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

      if (!canPlayOnTable(topTable, candidate, room.trumpSuit)) {
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
      room.dealerLog.push(`${actor.name} took oldest table card ${oldest.rank}${oldest.suit}`);
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
    const newlyFinished = room.players
      .filter((p) => p.cards.length === 0)
      .map((p) => p.id)
      .filter((id) => !room.finalRankingPlayerIds.includes(id));
    room.finalRankingPlayerIds.push(...newlyFinished);

    const playersWithCards = room.players.filter((p) => p.cards.length > 0);
    if (playersWithCards.length === 1) {
      room.phase = "FINISHED";
      room.loserPlayerId = playersWithCards[0].id;
      room.winnerPlayerIds = room.players.filter((p) => p.id !== playersWithCards[0].id).map((p) => p.id);

      const nonLoserIds = room.players.filter((p) => p.id !== room.loserPlayerId).map((p) => p.id);
      const trackedNonLosers = room.finalRankingPlayerIds.filter((id) => id !== room.loserPlayerId);
      const missingNonLosers = nonLoserIds.filter((id) => !trackedNonLosers.includes(id));
      room.finalRankingPlayerIds = [...trackedNonLosers, ...missingNonLosers];
      room.finalRankingPlayerIds.push(room.loserPlayerId);
      room.dealerLog.push("Game finished with final standings");
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
    const nextPlayerId = room.players[next]?.id ?? room.players[0]?.id ?? null;

    const activeLastAction = room.lastAction;
    if (
      room.phase === "DEALING" &&
      activeLastAction !== null &&
      activeLastAction.suspiciousType !== null &&
      activeLastAction.expiresOnActionByPlayerId === null &&
      activeLastAction.actorPlayerId === room.currentTurnPlayerId
    ) {
      room.lastAction = {
        ...activeLastAction,
        expiresOnActionByPlayerId: nextPlayerId,
      };
    }

    room.currentTurnPlayerId = nextPlayerId;
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
