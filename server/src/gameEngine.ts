import { randomUUID } from "node:crypto";
import type {
  ActionAnimatedEvent,
  AvatarId,
  CardBackgroundId,
  TableId,
  Card,
  ClientStatePayload,
  DealingAction,
  EffectId,
  DeckSize,
  DurakAction,
  DurakPair,
  GameType,
  HatId,
  NnnAction,
  PlayerAccountState,
  PlayerCardInfo,
  PlayerUnlocks,
  PendingFasiolasState,
  PendingThreeState,
  PlayerProfile,
  ProfileColor,
  ProfileSlot,
  PlayingAction,
  PublicTableState,
  Rank,
  RarityId,
  SkinId,
  ShopCatalogItem,
  ShopItemId,
  ShopItemType,
  Suit,
  TurnAction,
} from "../../shared/src/types";
import {
  AVATAR_PRICE_OVERRIDES,
  AVATAR_OPTIONS,
  AVATAR_RARITY,
  CARD_BACKGROUND_OPTIONS,
  CARD_BACKGROUND_RARITY,
  EFFECT_OPTIONS,
  EFFECT_RARITY,
  HAT_OPTIONS,
  HAT_RARITY,
  PROFILE_COLOR_OPTIONS,
  PROFILE_SLOT_OPTIONS,
  RARITY_PRICES,
  SKIN_OPTIONS,
  SKIN_RARITY,
  TABLE_OPTIONS,
  TABLE_RARITY,
  calcLevel,
} from "../../shared/src/types";

type InternalPlayer = {
  id: string;
  name: string;
  cards: Card[];
  // 999: atverstos (visiems matomos) ir aklos (uzverstos) kortos.
  faceUpCards: Card[];
  blindCards: Card[];
  socketId: string;
  authUserId: string | null;
  profile: PlayerProfile;
  isBot: boolean;
  // Atsijungimu valdymas: connected=false kol laukiam grizimo;
  // wasHuman=true zymi bota, kuris perime uz atsijungusi zmogu.
  connected: boolean;
  wasHuman?: boolean;
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
  gameType: GameType;
  tableId: TableId;
  turnStartedAt: number | null;
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
  matchRewards: MatchRewardRecord[] | null;
  password: string | null;
  lastActivityAt: number;
  // 999 laukai: isbrauktos kortos, laukiantis trejetas, praejusio maco cempionas.
  discardPile: Card[];
  pendingThree: PendingThreeState | null;
  lastChampionPlayerId: string | null;
  deckSize: DeckSize;
  durak: DurakRound | null;
};

type DurakRound = {
  attackerId: string;
  defenderId: string;
  pairs: DurakPair[];
  // Atakuotoju eile siame raunde (be gynejo) ir dabartine pozicija.
  attackerOrder: string[];
  attackerPos: number;
  passes: number;
  taking: boolean;
  attackLimit: number;
  discardedCount: number;
};

export type LobbySummary = {
  roomCode: string;
  hostName: string;
  playerCount: number;
  hasPassword: boolean;
  gameType: GameType;
  deckSize: DeckSize;
};

const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SHORT_RANKS: Rank[] = ["7", "8", "9", "10", "J", "Q", "K", "A"];

function ranksFor(deckSize: DeckSize): Rank[] {
  return deckSize === "short" ? SHORT_RANKS : RANKS;
}
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

const BASE_POINTS_PER_GAME = 200;
const TURN_TIMER_DURATION_MS = 15_000;
const TURN_TIMER_GRACE_MS = 350;
const PLACEMENT_BONUS: Record<number, number> = {
  1: 200,
  2: 100,
  3: 50,
};

function createDefaultProfile(seedIndex = 0): PlayerProfile {
  return {
    baseColor: PROFILE_COLOR_OPTIONS[seedIndex % PROFILE_COLOR_OPTIONS.length] as ProfileColor,
    avatarId: "warrior",
    hatId: "none",
    skinId: "default",
    effectId: "none",
    cardBackgroundId: "classic",
    tableId: "common_green",
    profileSlot: PROFILE_SLOT_OPTIONS[seedIndex % PROFILE_SLOT_OPTIONS.length] as ProfileSlot,
  };
}

function uniqueItems<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function createDefaultUnlocks(): PlayerUnlocks {
  return {
    avatars: AVATAR_OPTIONS.filter((id) => AVATAR_RARITY[id] === "common") as AvatarId[],
    hats: HAT_OPTIONS.filter((id) => HAT_RARITY[id] === "common") as HatId[],
    skins: SKIN_OPTIONS.filter((id) => SKIN_RARITY[id] === "common") as SkinId[],
    effects: EFFECT_OPTIONS.filter((id) => EFFECT_RARITY[id] === "common") as EffectId[],
    backgrounds: CARD_BACKGROUND_OPTIONS.filter((id) => CARD_BACKGROUND_RARITY[id] === "common") as CardBackgroundId[],
    tables: TABLE_OPTIONS.filter((id) => TABLE_RARITY[id] === "common") as TableId[],
  };
}

function createDefaultAccountState(): PlayerAccountState {
  return {
    points: 0,
    registeredAt: Date.now(),
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    unlocked: createDefaultUnlocks(),
  };
}

function cloneAccountState(account: PlayerAccountState): PlayerAccountState {
  return {
    points: account.points,
    registeredAt: account.registeredAt,
    gamesPlayed: account.gamesPlayed,
    gamesWon: account.gamesWon ?? 0,
    gamesLost: account.gamesLost ?? 0,
    unlocked: {
      avatars: [...account.unlocked.avatars],
      hats: [...account.unlocked.hats],
      skins: [...account.unlocked.skins],
      effects: [...account.unlocked.effects],
      backgrounds: [...account.unlocked.backgrounds],
      tables: [...(account.unlocked.tables ?? TABLE_OPTIONS.filter((id) => TABLE_RARITY[id] === "common"))],
    },
  };
}

function resolveItemRarity(type: ShopItemType, itemId: ShopItemId): RarityId {
  if (type === "avatar") {
    return AVATAR_RARITY[itemId as AvatarId];
  }
  if (type === "hat") {
    return HAT_RARITY[itemId as HatId];
  }
  if (type === "skin") {
    return SKIN_RARITY[itemId as SkinId];
  }
  if (type === "background") {
    return CARD_BACKGROUND_RARITY[itemId as CardBackgroundId];
  }
  if (type === "table") {
    return TABLE_RARITY[itemId as TableId];
  }
  return EFFECT_RARITY[itemId as EffectId];
}

function resolveItemCost(type: ShopItemType, itemId: ShopItemId): number {
  if (type === "avatar") {
    const avatarId = itemId as AvatarId;
    return AVATAR_PRICE_OVERRIDES[avatarId] ?? RARITY_PRICES[AVATAR_RARITY[avatarId]];
  }
  return RARITY_PRICES[resolveItemRarity(type, itemId)];
}

function resolveTableCost(tableId: TableId): number {
  return RARITY_PRICES[TABLE_RARITY[tableId]];
}

function chooseRoomTableId(players: InternalPlayer[]): TableId {
  let bestCost = -1;
  let candidates: TableId[] = [];

  for (const player of players) {
    const tableId = player.profile.tableId;
    const cost = resolveTableCost(tableId);
    if (cost > bestCost) {
      bestCost = cost;
      candidates = [tableId];
    } else if (cost === bestCost) {
      candidates.push(tableId);
    }
  }

  if (candidates.length === 0) {
    return "common_green";
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function isValidShopItem(type: ShopItemType, itemId: ShopItemId): boolean {
  if (type === "avatar") {
    return AVATAR_OPTIONS.includes(itemId as AvatarId);
  }
  if (type === "hat") {
    return HAT_OPTIONS.includes(itemId as HatId);
  }
  if (type === "skin") {
    return SKIN_OPTIONS.includes(itemId as SkinId);
  }
  if (type === "background") {
    return CARD_BACKGROUND_OPTIONS.includes(itemId as CardBackgroundId);
  }
  if (type === "table") {
    return TABLE_OPTIONS.includes(itemId as TableId);
  }
  return EFFECT_OPTIONS.includes(itemId as EffectId);
}

function nextRank(rank: Rank, deckSize: DeckSize = "full"): Rank {
  const ranks = ranksFor(deckSize);
  const index = ranks.indexOf(rank);
  if (index < 0) {
    return rank;
  }
  const nextIndex = (index + 1) % ranks.length;
  return ranks[nextIndex];
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

function createDeck(deckSize: DeckSize = "full"): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranksFor(deckSize)) {
      cards.push({ suit, rank });
    }
  }
  return shuffleDeck(cards);
}

// Durak: ar defense korta numusa attack (ta pati masti didesne arba koziris ant ne-kozirio).
function durakCanBeat(attack: Card, defense: Card, trumpSuit: Suit | null): boolean {
  if (defense.suit === attack.suit) {
    return RANK_ORDER[defense.rank] > RANK_ORDER[attack.rank];
  }
  return defense.suit === trumpSuit && attack.suit !== trumpSuit;
}

function canApplyPlusOne(baseTop: Card | null, cardToPlace: Card, deckSize: DeckSize = "full"): boolean {
  if (!baseTop) {
    return true;
  }
  const expected = nextRank(baseTop.rank, deckSize);
  return expected === cardToPlace.rank;
}

function isHigherSameSuit(base: Card, candidate: Card): boolean {
  return base.suit === candidate.suit && RANK_ORDER[candidate.rank] > RANK_ORDER[base.rank];
}

// ---------------------------------------------------------------------------
// 999 taisykliu helperiai. 7 apribojimas isvedamas vien is kruvos virsaus:
// 7 gali buti virsuje tik ka tik padeta (visi kruvos valymo ivykiai ja istustina).
// ---------------------------------------------------------------------------

const NNN_MAX_PLAYERS = 5;
const DURAK_HAND_SIZE = 6;
const DURAK_MAX_PLAYERS = 6;
const DURAK_MAX_PLAYERS_SHORT = 5;
const NNN_HAND_SIZE = 3;

function isNnnMagic(rank: Rank): boolean {
  return rank === "2" || rank === "3" || rank === "10";
}

function canPlayOnNnnPile(top: Card | null, rank: Rank): boolean {
  if (rank === "3") {
    return false;
  }
  if (rank === "2" || rank === "10") {
    return true;
  }
  if (!top || top.rank === "2") {
    return true;
  }
  if (top.rank === "7") {
    return RANK_ORDER[rank] <= 7;
  }
  return RANK_ORDER[rank] >= RANK_ORDER[top.rank];
}

function nnnTotalCards(player: InternalPlayer): number {
  return player.cards.length + player.faceUpCards.length + player.blindCards.length;
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

export type MatchRewardRecord = {
  playerId: string;
  authUserId: string | null;
  placement: number;
  reward: number;
  won: boolean;
};

export type ActionAnimationRecord = ActionAnimatedEvent & {
  actorSocketId: string;
};

const BOT_NAMES = ["Botas Vytas", "Botas Aldona", "Botas Zenonas", "Botas Grazina", "Botas Kazys", "Botas Birute"];

const BOT_ACTION_DELAY_MS = 800;

export class GameEngine {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly playerAccounts = new Map<string, PlayerAccountState>();
  private readonly botTimers = new Map<string, NodeJS.Timeout>();
  // "roomCode:playerId" -> grace timeris po zaidejo atsijungimo.
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private matchRewardsListener: ((rewards: MatchRewardRecord[]) => void) | null = null;
  private roomStateListener: ((roomCode: string) => void) | null = null;
  private actionListener: ((roomCode: string, info: ActionAnimationRecord) => void) | null = null;

  public setMatchRewardsListener(listener: (rewards: MatchRewardRecord[]) => void): void {
    this.matchRewardsListener = listener;
  }

  public setRoomStateListener(listener: (roomCode: string) => void): void {
    this.roomStateListener = listener;
  }

  public setActionListener(listener: (roomCode: string, info: ActionAnimationRecord) => void): void {
    this.actionListener = listener;
  }

  // Surenka animacijai reikalinga informacija PRIES veiksmo pritaikyma
  // (po jo atversta korta ar ranka jau pasikeitusi).
  private buildAnimationInfo(
    room: GameRoom,
    actorPlayerId: string,
    action: TurnAction,
  ): ActionAnimationRecord | null {
    const actor = room.players.find((p) => p.id === actorPlayerId);
    if (!actor) {
      return null;
    }

    const base = { actorPlayerId, actorSocketId: actor.socketId };

    if (action.type === "PLACE_REVEALED") {
      return { ...base, actionType: action.type, toPlayerId: action.toPlayerId, card: room.revealedDrawCard };
    }
    if (action.type === "MOVE_VISIBLE_CARD") {
      return { ...base, actionType: action.type, toPlayerId: action.toPlayerId, card: actor.cards[actor.cards.length - 1] ?? null };
    }
    if (action.type === "PLAY_CARD") {
      return { ...base, actionType: action.type, toPlayerId: null, card: actor.cards[action.cardIndex] ?? null };
    }
    if (action.type === "TAKE_OLDEST") {
      return { ...base, actionType: action.type, toPlayerId: null, card: room.tableStack[0] ?? null };
    }
    if (action.type === "PLAY_CARDS") {
      return { ...base, actionType: action.type, toPlayerId: null, card: actor.cards[action.cardIndexes[0]] ?? null };
    }
    if (action.type === "SHOW_THREE") {
      return { ...base, actionType: action.type, toPlayerId: action.targetPlayerId, card: actor.cards[action.cardIndex] ?? null };
    }
    if (action.type === "TAKE_PILE") {
      return { ...base, actionType: action.type, toPlayerId: null, card: room.tableStack[room.tableStack.length - 1] ?? null };
    }
    if (action.type === "PLAY_BLIND") {
      return { ...base, actionType: action.type, toPlayerId: null, card: actor.blindCards[action.blindIndex] ?? null };
    }
    if (action.type === "DURAK_ATTACK" || action.type === "DURAK_TRANSFER" || action.type === "DURAK_DEFEND") {
      return { ...base, actionType: action.type, toPlayerId: null, card: actor.cards[action.cardIndex] ?? null };
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Botai: po kiekvieno busenos pokycio patikrinam, ar botas turi veikti.
  // Veiksmai atliekami po viena su uzdelsimu, kad atrodytu naturaliai.
  // ---------------------------------------------------------------------

  public kickBots(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || this.botTimers.has(roomCode) || !this.botHasPendingAction(room)) {
      return;
    }

    const timer = setTimeout(() => {
      this.botTimers.delete(roomCode);
      try {
        if (this.performOneBotAction(roomCode)) {
          this.roomStateListener?.(roomCode);
          this.kickBots(roomCode);
        }
      } catch (error) {
        console.error("Boto veiksmo klaida:", error);
      }
    }, BOT_ACTION_DELAY_MS);
    this.botTimers.set(roomCode, timer);
  }

  private botHasPendingAction(room: GameRoom): boolean {
    if (room.phase !== "DEALING" && room.phase !== "PLAYING") {
      return false;
    }
    if (room.pendingFasiolas) {
      const pending = room.pendingFasiolas;
      return room.players.some(
        (p) =>
          p.isBot &&
          pending.requiredFromPlayerIds.includes(p.id) &&
          !pending.contributedFromPlayerIds.includes(p.id),
      );
    }
    if (room.pendingThree) {
      const target = room.players.find((p) => p.id === room.pendingThree?.targetPlayerId);
      return Boolean(target?.isBot);
    }
    const current = room.players.find((p) => p.id === room.currentTurnPlayerId);
    return Boolean(current?.isBot);
  }

  private performOneBotAction(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room || !this.botHasPendingAction(room)) {
      return false;
    }

    // Fasiolo bauda: botas atiduoda seniausia (ne virsutine) korta.
    if (room.pendingFasiolas) {
      const pending = room.pendingFasiolas;
      const bot = room.players.find(
        (p) =>
          p.isBot &&
          pending.requiredFromPlayerIds.includes(p.id) &&
          !pending.contributedFromPlayerIds.includes(p.id),
      );
      if (!bot) {
        return false;
      }
      this.resolveFasiolasContribution(roomCode, bot.id, 0);
      return true;
    }

    // 999: botas-taikinys atsako i parodyta trejeta (ginasi, jei turi 3).
    if (room.pendingThree) {
      const target = room.players.find((p) => p.id === room.pendingThree?.targetPlayerId);
      if (!target || !target.isBot) {
        return false;
      }
      const canDefend =
        target.cards.some((c) => c.rank === "3") || target.faceUpCards.some((c) => c.rank === "3");
      this.resolveThreeResponse(roomCode, target.id, canDefend);
      return true;
    }

    const bot = room.players.find((p) => p.id === room.currentTurnPlayerId);
    if (!bot || !bot.isBot) {
      return false;
    }

    if (room.gameType === "nnn") {
      if (room.phase !== "PLAYING") {
        return false;
      }
      this.applyTurnAction(roomCode, bot.id, this.decideBotNnnAction(room, bot));
      return true;
    }

    if (room.gameType === "durak") {
      if (room.phase !== "PLAYING") {
        return false;
      }
      this.applyTurnAction(roomCode, bot.id, this.decideDurakAction(room, bot, false));
      return true;
    }

    if (room.phase === "DEALING") {
      this.applyTurnAction(roomCode, bot.id, this.decideBotDealingAction(room, bot));
      return true;
    }

    if (room.phase === "PLAYING") {
      const playableIdx = this.findPlayableCardIndex(room, bot);
      const action: PlayingAction = playableIdx >= 0 ? { type: "PLAY_CARD", cardIndex: playableIdx } : { type: "TAKE_OLDEST" };
      this.applyTurnAction(roomCode, bot.id, action);
      return true;
    }

    return false;
  }

  // 999 boto strategija: zemiausia tinkama paprasta korta (visos kopijos),
  // tada 2, tada 10, tada trejeto rodymas, galiausiai kruvos paemimas.
  private decideBotNnnAction(room: GameRoom, bot: InternalPlayer): NnnAction {
    if (bot.cards.length === 0 && bot.faceUpCards.length === 0 && bot.blindCards.length > 0) {
      return { type: "PLAY_BLIND", blindIndex: 0 };
    }

    const top = room.tableStack[room.tableStack.length - 1] ?? null;
    const byRank = new Map<Rank, number[]>();
    bot.cards.forEach((card, index) => {
      const list = byRank.get(card.rank) ?? [];
      list.push(index);
      byRank.set(card.rank, list);
    });

    const playableRanks: Rank[] = [];
    for (const rank of byRank.keys()) {
      if (isNnnMagic(rank) || !canPlayOnNnnPile(top, rank)) {
        continue;
      }
      playableRanks.push(rank);
    }
    if (playableRanks.length > 0) {
      playableRanks.sort((a, b) => RANK_ORDER[a] - RANK_ORDER[b]);
      // Dazniausiai zemiausia, bet kartais kita tinkama - kitaip botai gali
      // amzinai ratu stumdyti ta pacia korta (pvz. viena 7 endgame'e).
      const bestRank =
        playableRanks.length > 1 && Math.random() < 0.25
          ? playableRanks[Math.floor(Math.random() * playableRanks.length)]
          : playableRanks[0];
      return { type: "PLAY_CARDS", cardIndexes: byRank.get(bestRank) ?? [] };
    }

    const twoIndexes = byRank.get("2");
    if (twoIndexes && twoIndexes.length > 0) {
      return { type: "PLAY_CARDS", cardIndexes: [twoIndexes[0]] };
    }
    const tenIndexes = byRank.get("10");
    if (tenIndexes && tenIndexes.length > 0) {
      return { type: "PLAY_CARDS", cardIndexes: [tenIndexes[0]] };
    }

    const threeIndex = bot.cards.findIndex((c) => c.rank === "3");
    if (threeIndex >= 0) {
      const opponents = room.players.filter((p) => p.id !== bot.id && nnnTotalCards(p) > 0);
      if (opponents.length > 0) {
        const target = opponents.reduce((a, b) => (nnnTotalCards(b) > nnnTotalCards(a) ? b : a));
        return { type: "SHOW_THREE", cardIndex: threeIndex, targetPlayerId: target.id };
      }
    }

    return { type: "TAKE_PILE" };
  }

  public expireTurnTimers(now = Date.now()): string[] {
    const changedRoomCodes: string[] = [];
    for (const [roomCode, room] of this.rooms.entries()) {
      if (this.applyTurnTimeout(roomCode, room, now)) {
        changedRoomCodes.push(roomCode);
      }
    }
    return changedRoomCodes;
  }

  private applyTurnTimeout(roomCode: string, room: GameRoom, now: number): boolean {
    if (
      (room.phase !== "DEALING" && room.phase !== "PLAYING") ||
      room.pendingFasiolas ||
      room.pendingThree ||
      !room.currentTurnPlayerId ||
      !room.turnStartedAt ||
      now - room.turnStartedAt < TURN_TIMER_DURATION_MS + TURN_TIMER_GRACE_MS
    ) {
      return false;
    }

    const player = room.players.find((p) => p.id === room.currentTurnPlayerId);
    if (!player) {
      room.currentTurnPlayerId = null;
      this.resetTurnTimer(room);
      return true;
    }

    try {
      if (room.gameType === "durak") {
        this.applyTurnAction(roomCode, player.id, this.decideDurakAction(room, player, true));
        room.dealerLog.push(`${player.name} praleido laika - atliktas automatinis ejimas`);
        return true;
      }

      if (room.gameType === "nnn") {
        this.applyTurnAction(roomCode, player.id, this.decideTimeoutNnnAction(room, player));
        room.dealerLog.push(`${player.name} praleido laika - atliktas automatinis ejimas`);
        return true;
      }

      if (room.phase === "DEALING") {
        this.applyTimeoutDealingAction(roomCode, room, player);
        return true;
      }

      const action = this.decideTimeoutPlayingAction(room, player);
      if (action) {
        this.applyTurnAction(roomCode, player.id, action);
        room.dealerLog.push(`${player.name} praleido laika - atliktas automatinis ejimas`);
        return true;
      }

      this.advanceTurn(room);
      room.dealerLog.push(`${player.name} praleido laika - ejimas perduotas toliau`);
      return true;
    } catch (error) {
      console.error("Automatinio ejimo klaida:", error);
      room.turnStartedAt = now;
      return true;
    }
  }

  private applyTimeoutDealingAction(roomCode: string, room: GameRoom, player: InternalPlayer): void {
    if (!room.revealedDrawCard && room.centerDeck.length > 0) {
      this.applyTurnAction(roomCode, player.id, { type: "DRAW_REVEAL" });
    }

    if (room.revealedDrawCard) {
      this.applyTurnAction(roomCode, player.id, { type: "PLACE_REVEALED", toPlayerId: player.id });
      room.dealerLog.push(`${player.name} praleido laika - korta automatiskai padeta sau`);
      return;
    }

    this.applyTurnAction(roomCode, player.id, { type: "END_TURN" });
    room.dealerLog.push(`${player.name} praleido laika - ejimas perduotas toliau`);
  }

  private decideTimeoutPlayingAction(room: GameRoom, player: InternalPlayer): PlayingAction | null {
    if (room.tableStack.length > 0) {
      return { type: "TAKE_OLDEST" };
    }
    const playableIdx = this.findPlayableCardIndex(room, player);
    return playableIdx >= 0 ? { type: "PLAY_CARD", cardIndex: playableIdx } : null;
  }

  private decideTimeoutNnnAction(room: GameRoom, player: InternalPlayer): NnnAction {
    if (player.cards.length === 0 && player.faceUpCards.length === 0 && player.blindCards.length > 0) {
      return { type: "PLAY_BLIND", blindIndex: 0 };
    }
    if (room.tableStack.length > 0) {
      return { type: "TAKE_PILE" };
    }
    const playableIndex = player.cards.findIndex((card) => card.rank !== "3");
    if (playableIndex >= 0) {
      return { type: "PLAY_CARDS", cardIndexes: [playableIndex] };
    }
    const threeIndex = player.cards.findIndex((card) => card.rank === "3");
    const target = room.players.find((candidate) => candidate.id !== player.id && nnnTotalCards(candidate) > 0);
    if (threeIndex >= 0 && target) {
      return { type: "SHOW_THREE", cardIndex: threeIndex, targetPlayerId: target.id };
    }
    return { type: "PLAY_BLIND", blindIndex: 0 };
  }

  private decideBotDealingAction(room: GameRoom, bot: InternalPlayer): DealingAction {
    const others = room.players.filter((p) => p.id !== bot.id);

    // 1. Jei jau atversta korta - padeti pagal taisykles: kitam, jei +1 legalu.
    if (room.revealedDrawCard) {
      const drawn = room.revealedDrawCard;
      const plusOneTarget = others.find((p) => canApplyPlusOne(p.cards[p.cards.length - 1] ?? null, drawn, room.deckSize));
      return { type: "PLACE_REVEALED", toPlayerId: plusOneTarget?.id ?? bot.id };
    }

    // 2. Jei sava virsutine korta legaliai limpa kitam (+1) - perkelti.
    const botTop = bot.cards[bot.cards.length - 1] ?? null;
    if (botTop) {
      const moveTarget = others.find((p) => canApplyPlusOne(p.cards[p.cards.length - 1] ?? null, botTop, room.deckSize));
      if (moveTarget) {
        return { type: "MOVE_VISIBLE_CARD", toPlayerId: moveTarget.id };
      }
    }

    // 3. Kitu atveju traukti is kalades (jei tuscia - baigti ejima).
    if (room.centerDeck.length > 0) {
      return { type: "DRAW_REVEAL" };
    }
    return { type: "END_TURN" };
  }

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
      if (canApplyPlusOne(candidateTop, card, room.deckSize)) {
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

  public createRoom(
    hostName: string,
    socketId: string,
    profile?: PlayerProfile,
    options?: {
      authUserId?: string | null;
      registeredAt?: number;
      password?: string | null;
      gameType?: GameType;
      deckSize?: DeckSize;
    },
  ): { roomCode: string; playerId: string } {
    const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const playerId = randomUUID();
    const playerProfile = profile ?? createDefaultProfile(0);
    this.ensureAccount(playerId, playerProfile, { registeredAt: options?.registeredAt });
    this.rooms.set(roomCode, {
      code: roomCode,
      gameType: options?.gameType ?? "fasiolas",
      deckSize: options?.deckSize ?? (options?.gameType === "durak" ? "short" : "full"),
      durak: null,
      tableId: playerProfile.tableId,
      turnStartedAt: null,
      players: [
        {
          id: playerId,
          name: hostName,
          cards: [],
          faceUpCards: [],
          blindCards: [],
          socketId,
          authUserId: options?.authUserId ?? null,
          profile: playerProfile,
          isBot: false,
          connected: true,
        },
      ],
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
      matchRewards: null,
      password: options?.password?.trim() || null,
      lastActivityAt: Date.now(),
      discardPile: [],
      pendingThree: null,
      lastChampionPlayerId: null,
    });
    return { roomCode, playerId };
  }

  private maxPlayersFor(room: GameRoom): number {
    const short = room.deckSize === "short";
    if (room.gameType === "nnn") {
      // 9 kortos kiekvienam: 32 kortu kalade pakanka tik 3 zaidejams.
      return short ? 3 : NNN_MAX_PLAYERS;
    }
    if (room.gameType === "durak") {
      return short ? DURAK_MAX_PLAYERS_SHORT : DURAK_MAX_PLAYERS;
    }
    return 8;
  }

  private resetTurnTimer(room: GameRoom): void {
    room.turnStartedAt = room.currentTurnPlayerId ? Date.now() : null;
  }

  // Vieso lobby saraso santrauka: tik dar neprasideje kambariai.
  public listLobbies(): LobbySummary[] {
    const lobbies: LobbySummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.phase !== "LOBBY") {
        continue;
      }
      const host = room.players.find((p) => !p.isBot) ?? room.players[0];
      lobbies.push({
        roomCode: room.code,
        hostName: host?.name ?? "?",
        playerCount: room.players.length,
        hasPassword: Boolean(room.password),
        gameType: room.gameType,
        deckSize: room.deckSize,
      });
    }
    return lobbies;
  }

  public joinRoom(
    roomCode: string,
    name: string,
    socketId: string,
    profile?: PlayerProfile,
    options?: { authUserId?: string | null; registeredAt?: number; password?: string | null },
  ): { playerId: string } {
    const room = this.getRoomOrThrow(roomCode);
    if (room.players.length >= this.maxPlayersFor(room)) {
      throw new Error("Room is full");
    }
    if (room.phase !== "LOBBY") {
      throw new Error("Game already started");
    }
    if (room.password && room.password !== (options?.password?.trim() || "")) {
      throw new Error("Neteisingas kambario slaptazodis");
    }
    const playerId = randomUUID();
    const playerProfile = profile ?? createDefaultProfile(room.players.length);
    this.ensureAccount(playerId, playerProfile, { registeredAt: options?.registeredAt });
    room.players.push({
      id: playerId,
      name,
      cards: [],
      faceUpCards: [],
      blindCards: [],
      socketId,
      authUserId: options?.authUserId ?? null,
      profile: playerProfile,
      isBot: false,
      connected: true,
    });
    return { playerId };
  }

  public addBot(roomCode: string): { playerId: string } {
    const room = this.getRoomOrThrow(roomCode);
    if (room.players.length >= this.maxPlayersFor(room)) {
      throw new Error("Room is full");
    }
    if (room.phase !== "LOBBY") {
      throw new Error("Bota galima prideti tik lobby fazeje");
    }

    const usedNames = new Set(room.players.map((p) => p.name));
    const botName =
      BOT_NAMES.find((candidate) => !usedNames.has(candidate)) ??
      `Botas ${room.players.filter((p) => p.isBot).length + 1}`;

    const playerId = randomUUID();
    const botProfile = createDefaultProfile(room.players.length);
    const commonAvatars = AVATAR_OPTIONS.filter((id) => AVATAR_RARITY[id] === "common");
    botProfile.avatarId = commonAvatars[Math.floor(Math.random() * commonAvatars.length)];

    this.ensureAccount(playerId, botProfile);
    room.players.push({
      id: playerId,
      name: botName,
      cards: [],
      faceUpCards: [],
      blindCards: [],
      socketId: `bot:${playerId}`,
      authUserId: null,
      profile: botProfile,
      isBot: true,
      connected: true,
    });
    room.dealerLog.push(`${botName} prisijunge prie kambario`);
    return { playerId };
  }

  public updateProfile(roomCode: string, playerId: string, profile: PlayerProfile): void {
    const room = this.getRoomOrThrow(roomCode);
    if (room.phase !== "LOBBY") {
      throw new Error("Profile can be updated only in lobby");
    }

    const player = this.getPlayerOrThrow(room, playerId);
    const account = this.getAccountOrThrow(playerId);
    if (!this.canUseProfileItems(account, profile)) {
      throw new Error("Profile contains locked items");
    }
    player.profile = profile;
  }

  public getAccountState(playerId: string): PlayerAccountState {
    const account = this.getAccountOrThrow(playerId);
    return cloneAccountState(account);
  }

  public getShopCatalog(): ShopCatalogItem[] {
    const catalog: ShopCatalogItem[] = [];

    for (const avatarId of AVATAR_OPTIONS) {
      const rarity = AVATAR_RARITY[avatarId];
      catalog.push({ type: "avatar", id: avatarId, rarity, cost: resolveItemCost("avatar", avatarId) });
    }

    for (const hatId of HAT_OPTIONS) {
      const rarity = HAT_RARITY[hatId];
      catalog.push({ type: "hat", id: hatId, rarity, cost: RARITY_PRICES[rarity] });
    }

    for (const skinId of SKIN_OPTIONS) {
      const rarity = SKIN_RARITY[skinId];
      catalog.push({ type: "skin", id: skinId, rarity, cost: RARITY_PRICES[rarity] });
    }

    for (const effectId of EFFECT_OPTIONS) {
      const rarity = EFFECT_RARITY[effectId];
      catalog.push({ type: "effect", id: effectId, rarity, cost: RARITY_PRICES[rarity] });
    }

    for (const backgroundId of CARD_BACKGROUND_OPTIONS) {
      const rarity = CARD_BACKGROUND_RARITY[backgroundId];
      catalog.push({ type: "background", id: backgroundId, rarity, cost: RARITY_PRICES[rarity] });
    }

    for (const tableId of TABLE_OPTIONS) {
      const rarity = TABLE_RARITY[tableId];
      catalog.push({ type: "table", id: tableId, rarity, cost: RARITY_PRICES[rarity] });
    }

    return catalog;
  }

  public purchaseShopItem(playerId: string, type: ShopItemType, itemId: ShopItemId): PlayerAccountState {
    if (!isValidShopItem(type, itemId)) {
      throw new Error("Invalid shop item");
    }

    const account = this.getAccountOrThrow(playerId);
    if (this.isItemUnlocked(account, type, itemId)) {
      throw new Error("Item already owned");
    }

    const cost = resolveItemCost(type, itemId);
    if (account.points < cost) {
      throw new Error("Not enough points");
    }

    account.points -= cost;
    this.unlockItem(account, type, itemId);
    return cloneAccountState(account);
  }

  public startGame(roomCode: string): void {
    const room = this.getRoomOrThrow(roomCode);
    if (room.players.length < 2) {
      throw new Error("Need at least 2 players");
    }
    if (room.players.length > this.maxPlayersFor(room)) {
      throw new Error(`Per daug zaideju sio tipo zaidimui su ${room.deckSize === "short" ? "32" : "52"} kortu kalade`);
    }
    if (room.gameType === "nnn") {
      this.startNnnGame(room);
      return;
    }
    if (room.gameType === "durak") {
      this.startDurakGame(room);
      return;
    }
    room.tableId = chooseRoomTableId(room.players);
    room.phase = "DEALING";
    room.centerDeck = createDeck(room.deckSize);
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
      p.faceUpCards = [];
      p.blindCards = [];
    }

    for (const p of room.players) {
      const card = room.centerDeck.pop();
      if (!card) {
        break;
      }
      p.cards.push(card);
    }

    room.currentTurnPlayerId = room.players[0]?.id ?? null;
    this.resetTurnTimer(room);
  }

  // 999 startas: DEALING faze praleidziama - iskart dalinama 3 aklos +
  // 3 atverstos + 3 i ranka ir pereinama i PLAYING.
  private startNnnGame(room: GameRoom): void {
    room.tableId = chooseRoomTableId(room.players);
    room.phase = "PLAYING";
    room.centerDeck = createDeck(room.deckSize);
    room.revealedDrawCard = null;
    room.tableStack = [];
    room.trumpSuit = null;
    room.lastNonSpadeDrawnSuit = null;
    room.winnerPlayerIds = [];
    room.loserPlayerId = null;
    room.finalRankingPlayerIds = [];
    room.pendingFasiolas = null;
    room.pendingFasiolasCards = new Map();
    room.lastAction = null;
    room.matchRewards = null;
    room.discardPile = [];
    room.pendingThree = null;
    room.dealerLog = ["Prasidejo 999 zaidimas"];

    for (const p of room.players) {
      p.cards = [];
      p.faceUpCards = [];
      p.blindCards = [];
    }
    for (const p of room.players) {
      for (let i = 0; i < NNN_HAND_SIZE; i += 1) {
        const blind = room.centerDeck.pop();
        if (blind) p.blindCards.push(blind);
        const faceUp = room.centerDeck.pop();
        if (faceUp) p.faceUpCards.push(faceUp);
        const hand = room.centerDeck.pop();
        if (hand) p.cards.push(hand);
      }
    }

    const champion = room.lastChampionPlayerId
      ? room.players.find((p) => p.id === room.lastChampionPlayerId)
      : null;
    const starter = champion ?? room.players[Math.floor(Math.random() * room.players.length)];
    room.currentTurnPlayerId = starter?.id ?? null;
    this.resetTurnTimer(room);
    if (starter) {
      room.dealerLog.push(champion ? `Pradeda cempionas ${starter.name}` : `Pradeda ${starter.name}`);
    }
  }

  public applyTurnAction(roomCode: string, actorPlayerId: string, action: TurnAction): void {
    const room = this.getRoomOrThrow(roomCode);

    if (room.pendingFasiolas) {
      throw new Error("Resolve fasiolas first");
    }

    if (room.pendingThree) {
      throw new Error("Pirmiau turi buti atsakyta i parodyta trejeta");
    }

    if (room.currentTurnPlayerId !== actorPlayerId) {
      throw new Error("Not your turn");
    }

    const animationInfo = this.buildAnimationInfo(room, actorPlayerId, action);

    if (room.gameType === "nnn") {
      if (room.phase !== "PLAYING") {
        throw new Error("Game is not active");
      }
      this.applyNnnAction(room, actorPlayerId, action as NnnAction);
    } else if (room.gameType === "durak") {
      if (room.phase !== "PLAYING") {
        throw new Error("Game is not active");
      }
      this.applyDurakAction(room, actorPlayerId, action as DurakAction);
    } else if (room.phase === "DEALING") {
      this.applyDealingAction(room, actorPlayerId, action as DealingAction);
      this.tryTransitionToPlaying(room);
    } else if (room.phase === "PLAYING") {
      this.applyPlayingAction(room, actorPlayerId, action as PlayingAction);
      this.checkPlayEnd(room);
    } else {
      throw new Error("Game is not active");
    }

    this.resetTurnTimer(room);

    // Tik po sekmingo pritaikymo - klaidos atveju animacijos nereikia.
    if (animationInfo) {
      this.actionListener?.(roomCode, animationInfo);
    }
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
      .filter((p) => p.id !== accusedPlayerId && p.cards.length > 1)
      .map((p) => p.id);

    if (requiredFromPlayerIds.length === 0) {
      throw new Error("No players can contribute fasiolas card");
    }

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
    this.resetTurnTimer(room);
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
    if (cardIndex === isTopCardIndex && fromPlayer.cards.length > 1) {
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

      if (room.phase === "DEALING") {
        this.tryTransitionToPlaying(room);
      }
    }
  }

  public updateSocket(roomCode: string, playerId: string, socketId: string): void {
    const room = this.getRoomOrThrow(roomCode);
    const player = room.players.find((p) => p.id === playerId);
    if (!player || (player.isBot && !player.wasHuman)) {
      throw new Error("Player not found");
    }
    const timerKey = `${roomCode}:${playerId}`;
    const timer = this.disconnectTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(timerKey);
    }
    player.socketId = socketId;
    player.connected = true;
    if (player.isBot && player.wasHuman) {
      player.isBot = false;
      room.dealerLog.push(`${player.name} grizo i zaidima`);
    }
  }

  // Zaidejo socketas nutruko: pazymim, praneshame ir po grace periodo
  // perleidziam vieta botui (LOBBY fazeje - tiesiog isimam is kambario).
  public handleDisconnect(roomCode: string, playerId: string, socketId: string): boolean {
    const room = this.rooms.get(roomCode);
    const player = room?.players.find((p) => p.id === playerId);
    // Ignoruojam pasenusius socketus (pvz., antras tabas jau perime vieta).
    if (!room || !player || player.isBot || player.socketId !== socketId) {
      return false;
    }
    if (room.phase === "FINISHED") {
      player.connected = false;
      return true;
    }
    player.connected = false;
    const graceMs = Number(process.env.DISCONNECT_GRACE_MS ?? 30000);
    room.dealerLog.push(`${player.name} atsijunge - laukiame ${Math.round(graceMs / 1000)} s`);
    const timerKey = `${roomCode}:${playerId}`;
    const existing = this.disconnectTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(timerKey);
      this.expireDisconnected(roomCode, playerId);
    }, graceMs);
    this.disconnectTimers.set(timerKey, timer);
    return true;
  }

  private expireDisconnected(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode);
    const player = room?.players.find((p) => p.id === playerId);
    if (!room || !player || player.connected || player.isBot) {
      return;
    }
    if (room.phase === "DEALING" || room.phase === "PLAYING") {
      player.isBot = true;
      player.wasHuman = true;
      room.dealerLog.push(`Uz ${player.name} toliau zaidzia botas`);
      this.roomStateListener?.(roomCode);
      this.kickBots(roomCode);
    } else if (room.phase === "LOBBY") {
      room.players = room.players.filter((p) => p.id !== playerId);
      room.dealerLog.push(`${player.name} paliko kambari`);
      if (!room.players.some((p) => !p.isBot)) {
        this.destroyRoom(roomCode);
        return;
      }
      this.roomStateListener?.(roomCode);
    }
  }

  public getClientState(roomCode: string, viewerPlayerId: string): ClientStatePayload {
    const room = this.getRoomOrThrow(roomCode);
    const viewer = room.players.find((p) => p.id === viewerPlayerId);
    if (!viewer) {
      throw new Error("Viewer not in room");
    }

    if (room.phase === "DEALING") {
      this.reconcilePendingFasiolas(room);
      if (room.pendingFasiolas === null) {
        this.tryTransitionToPlaying(room);
      }
    }

    if (room.pendingThree) {
      this.reconcilePendingThree(room);
    }

    const isNnn = room.gameType === "nnn";
    const isDurak = room.gameType === "durak";

    return {
      yourPlayerId: viewer.id,
      yourHand: [...viewer.cards],
      account: cloneAccountState(this.getAccountOrThrow(viewer.id)),
      state: {
        phase: room.phase,
        roomCode: room.code,
        currentTurnPlayerId: room.currentTurnPlayerId,
        players: room.players.map((p) => ({
          id: p.id,
          name: p.name,
          cardCount: p.cards.length,
          // 999: rankos kortos slaptos - virsutines NIEKADA nerodom.
          topCard: isNnn || isDurak ? null : (p.cards[p.cards.length - 1] ?? null),
          profile: p.profile,
          isBot: p.isBot,
          connected: p.connected,
          faceUpCards: isNnn ? [...p.faceUpCards] : undefined,
          blindCount: isNnn ? p.blindCards.length : undefined,
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
        matchRewards: room.matchRewards
          ? room.matchRewards.map(({ playerId, placement, reward, won }) => ({ playerId, placement, reward, won }))
          : null,
        gameType: room.gameType,
        tableId: room.tableId,
        turnStartedAt: room.turnStartedAt,
        turnTimerDurationMs: TURN_TIMER_DURATION_MS,
        discardedCount: room.discardPile.length,
        pendingThree: room.pendingThree,
        deckSize: room.deckSize,
        durak: room.durak
          ? {
              attackerId: room.durak.attackerId,
              defenderId: room.durak.defenderId,
              pairs: room.durak.pairs.map((pair) => ({ attack: pair.attack, defense: pair.defense })),
              trumpCard: room.centerDeck[0] ?? null,
              taking: room.durak.taking,
              discardedCount: room.durak.discardedCount,
              attackLimit: room.durak.attackLimit,
            }
          : null,
      },
    };
  }

  // Apsauga: jei parodyto trejeto taikinys dingo is kambario, trejetas
  // israsomas ir zaidimas testesi (analogija reconcilePendingFasiolas).
  private reconcilePendingThree(room: GameRoom): void {
    const pending = room.pendingThree;
    if (!pending) {
      return;
    }
    const target = room.players.find((p) => p.id === pending.targetPlayerId);
    if (target) {
      return;
    }
    room.discardPile.push(pending.card);
    room.pendingThree = null;
    room.dealerLog.push("Trejetas israsytas - taikinys nebe zaidime");
    this.checkNnnEnd(room);
    if (room.phase === "PLAYING") {
      this.advanceNnnTurn(room, pending.showerPlayerId);
      this.resetTurnTimer(room);
    }
  }

  public getRoomPlayerSocketIds(roomCode: string): string[] {
    const room = this.getRoomOrThrow(roomCode);
    return room.players.map((p) => p.socketId);
  }

  public getPlayerCardInfo(
    roomCode: string,
    targetPlayerId: string,
  ): PlayerCardInfo {
    const room = this.getRoomOrThrow(roomCode);
    const player = room.players.find((p) => p.id === targetPlayerId);
    if (!player) {
      throw new Error("Player not found");
    }
    const account = this.playerAccounts.get(targetPlayerId) ?? createDefaultAccountState();
    return {
      playerName: player.name,
      registeredAt: account.registeredAt,
      gamesPlayed: account.gamesPlayed,
      gamesWon: account.gamesWon ?? 0,
      gamesLost: account.gamesLost ?? 0,
      level: calcLevel(account.gamesPlayed),
    };
  }

  public getPlayerAuthUserId(roomCode: string, targetPlayerId: string): string | null {
    const room = this.getRoomOrThrow(roomCode);
    const player = room.players.find((p) => p.id === targetPlayerId);
    if (!player) {
      throw new Error("Player not found");
    }
    return player.authUserId;
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
      const legalPlusOne = canApplyPlusOne(targetTop, movingCard, room.deckSize);

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
          .some((p) => canApplyPlusOne(p.cards[p.cards.length - 1] ?? null, actorTop, room.deckSize));

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
      const legalPlusOne = canApplyPlusOne(targetTop, drawn, room.deckSize);

      if (target.id === actorPlayerId) {
        const actorTopBeforePlace = actor.cards[actor.cards.length - 1] ?? null;
        const hadNoCardsBeforePlace = actor.cards.length === 0;
        const canPlaceToOthers = room.players
          .filter((p) => p.id !== actorPlayerId)
          .some((p) => canApplyPlusOne(p.cards[p.cards.length - 1] ?? null, drawn, room.deckSize));

        actor.cards.push(drawn);
        room.revealedDrawCard = null;
        this.recordLastAction(room, actorPlayerId, canPlaceToOthers ? "SHOULD_HAVE_PLACED_TO_OTHER" : null, action.type);

        if (hadNoCardsBeforePlace || !canApplyPlusOne(actorTopBeforePlace, drawn, room.deckSize)) {
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
      // Baiges korteles zaidejas nebegauna ejimo - perduodam toliau.
      const actor = room.players.find((p) => p.id === actorPlayerId);
      if (actor && actor.cards.length === 0) {
        this.advanceTurn(room);
      }
      return;
    }
    this.advanceTurn(room);
  }

  // -------------------------------------------------------------------------
  // Durak (perevodnoy) logika
  // -------------------------------------------------------------------------

  private startDurakGame(room: GameRoom): void {
    room.tableId = chooseRoomTableId(room.players);
    room.phase = "PLAYING";
    room.centerDeck = createDeck(room.deckSize);
    room.revealedDrawCard = null;
    room.tableStack = [];
    // Kozirio korta - apatine kalades korta (imama paskutine).
    room.trumpSuit = room.centerDeck[0]?.suit ?? null;
    room.lastNonSpadeDrawnSuit = null;
    room.winnerPlayerIds = [];
    room.loserPlayerId = null;
    room.finalRankingPlayerIds = [];
    room.pendingFasiolas = null;
    room.pendingFasiolasCards = new Map();
    room.lastAction = null;
    room.matchRewards = null;
    room.discardPile = [];
    room.pendingThree = null;
    room.durak = null;
    room.dealerLog = ["Prasidejo Durak zaidimas"];

    for (const p of room.players) {
      p.cards = [];
      p.faceUpCards = [];
      p.blindCards = [];
      this.durakDrawUp(room, p);
    }

    // Pirmas atakuoja zaidejas su maziausiu koziriu; jei nieko - atsitiktinis.
    let starter: InternalPlayer | null = null;
    let lowest = Infinity;
    for (const p of room.players) {
      for (const c of p.cards) {
        if (c.suit === room.trumpSuit && RANK_ORDER[c.rank] < lowest) {
          lowest = RANK_ORDER[c.rank];
          starter = p;
        }
      }
    }
    starter = starter ?? room.players[Math.floor(Math.random() * room.players.length)];
    room.dealerLog.push(`Pirmas atakuoja ${starter.name}`);
    this.durakBeginBout(room, starter.id, 0);
  }

  private durakDrawUp(room: GameRoom, player: InternalPlayer): void {
    while (room.centerDeck.length > 0 && player.cards.length < DURAK_HAND_SIZE) {
      const card = room.centerDeck.pop();
      if (!card) break;
      player.cards.push(card);
    }
  }

  // Zaidejai pagal sedejimo eile pradedant nuo startId (imtinai), tik turintys kortu.
  private durakOrderFrom(room: GameRoom, startId: string): InternalPlayer[] {
    const idx = room.players.findIndex((p) => p.id === startId);
    if (idx < 0) {
      return [];
    }
    const ordered: InternalPlayer[] = [];
    for (let i = 0; i < room.players.length; i += 1) {
      const p = room.players[(idx + i) % room.players.length];
      if (i === 0 || p.cards.length > 0) {
        ordered.push(p);
      }
    }
    return ordered;
  }

  private durakNextActive(room: GameRoom, fromId: string): InternalPlayer | null {
    const order = this.durakOrderFrom(room, fromId);
    return order.find((p) => p.id !== fromId) ?? null;
  }

  private durakBeginBout(room: GameRoom, attackerId: string, discardedCount: number): void {
    const defender = this.durakNextActive(room, attackerId);
    if (!defender) {
      this.durakFinish(room);
      return;
    }
    const attackerOrder = this.durakOrderFrom(room, attackerId)
      .filter((p) => p.id !== defender.id)
      .map((p) => p.id);
    room.durak = {
      attackerId,
      defenderId: defender.id,
      pairs: [],
      attackerOrder,
      attackerPos: 0,
      passes: 0,
      taking: false,
      attackLimit: Math.min(DURAK_HAND_SIZE, defender.cards.length),
      discardedCount,
    };
    room.currentTurnPlayerId = attackerId;
    this.resetTurnTimer(room);
  }

  private durakTableRanks(round: DurakRound): Set<Rank> {
    const ranks = new Set<Rank>();
    for (const pair of round.pairs) {
      ranks.add(pair.attack.rank);
      if (pair.defense) {
        ranks.add(pair.defense.rank);
      }
    }
    return ranks;
  }

  private durakCanAdd(room: GameRoom, round: DurakRound, player: InternalPlayer): boolean {
    if (round.pairs.length === 0 || round.pairs.length >= round.attackLimit || player.cards.length === 0) {
      return false;
    }
    const defender = this.getPlayerOrThrow(room, round.defenderId);
    const undefended = round.pairs.filter((pair) => !pair.defense).length;
    if (!round.taking && undefended + 1 > defender.cards.length) {
      return false;
    }
    const ranks = this.durakTableRanks(round);
    return player.cards.some((c) => ranks.has(c.rank));
  }

  // Randa kita atakuotoja, kuris dar gali ka nors prideti; jei nieko - raundas baigiasi.
  private durakAdvanceAttackers(room: GameRoom, round: DurakRound): void {
    for (let guard = 0; guard < 64; guard += 1) {
      const len = round.attackerOrder.length;
      if (len === 0 || round.passes >= len) {
        this.durakResolveBout(room, round.taking);
        return;
      }
      const attackerId = round.attackerOrder[round.attackerPos % len];
      const attacker = this.getPlayerOrThrow(room, attackerId);
      if (this.durakCanAdd(room, round, attacker)) {
        room.currentTurnPlayerId = attackerId;
        this.resetTurnTimer(room);
        return;
      }
      round.passes += 1;
      round.attackerPos = (round.attackerPos + 1) % len;
    }
    this.durakResolveBout(room, round.taking);
  }

  private durakResolveBout(room: GameRoom, taken: boolean): void {
    const round = room.durak;
    if (!round) {
      return;
    }
    const defender = this.getPlayerOrThrow(room, round.defenderId);
    const tableCards = round.pairs.flatMap((pair) => (pair.defense ? [pair.attack, pair.defense] : [pair.attack]));
    let discardedCount = round.discardedCount;
    if (taken) {
      defender.cards.push(...tableCards);
      room.dealerLog.push(`${defender.name} pasieme ${tableCards.length} kortas`);
    } else {
      room.discardPile.push(...tableCards);
      discardedCount += tableCards.length;
      room.dealerLog.push("Bita - kortos isbrauktos");
    }

    // Papildymas: atakuotojai pirma (nuo pagrindinio), gynejas paskutinis.
    const drawOrder = this.durakOrderFrom(room, round.attackerId).filter((p) => p.id !== defender.id);
    // Zaidejai be kortu, bet dar neturintys vietos, i orda nepatenka - papildom ir juos.
    for (const p of room.players) {
      if (p.id !== defender.id && !drawOrder.includes(p)) {
        drawOrder.push(p);
      }
    }
    for (const p of [...drawOrder, defender]) {
      this.durakDrawUp(room, p);
    }

    // Baigusieji (kalade tuscia, ranka tuscia) fiksuojami pagal baigimo tvarka.
    if (room.centerDeck.length === 0) {
      for (const p of room.players) {
        if (p.cards.length === 0 && !room.finalRankingPlayerIds.includes(p.id)) {
          room.finalRankingPlayerIds.push(p.id);
          room.dealerLog.push(`${p.name} isejo is zaidimo`);
        }
      }
    }

    const active = room.players.filter((p) => p.cards.length > 0);
    if (active.length <= 1) {
      room.durak = { ...round, pairs: [], discardedCount };
      this.durakFinish(room);
      return;
    }

    const nextAttacker = taken || defender.cards.length === 0 ? this.durakNextActive(room, defender.id) : defender;
    this.durakBeginBout(room, (nextAttacker ?? defender).id, discardedCount);
  }

  private durakFinish(room: GameRoom): void {
    const loser = room.players.find((p) => p.cards.length > 0) ?? null;
    room.phase = "FINISHED";
    room.loserPlayerId = loser?.id ?? null;
    const ranking = room.finalRankingPlayerIds.filter((id) => id !== loser?.id);
    for (const p of room.players) {
      if (p.id !== loser?.id && !ranking.includes(p.id)) {
        ranking.push(p.id);
      }
    }
    if (loser) {
      ranking.push(loser.id);
    }
    room.finalRankingPlayerIds = ranking;
    room.winnerPlayerIds = room.players.filter((p) => p.id !== loser?.id).map((p) => p.id);
    room.dealerLog.push(loser ? `${loser.name} lieka durnius` : "Lygiosios - durnio nera");
    room.currentTurnPlayerId = null;
    room.pendingThree = null;
    this.resetTurnTimer(room);
    this.applyMatchRewards(room);
  }

  private applyDurakAction(room: GameRoom, actorPlayerId: string, action: DurakAction): void {
    const round = room.durak;
    if (!round) {
      throw new Error("Durak raundas nepradetas");
    }
    const actor = this.getPlayerOrThrow(room, actorPlayerId);
    const defender = this.getPlayerOrThrow(room, round.defenderId);
    const isDefender = actorPlayerId === round.defenderId;

    if (action.type === "DURAK_ATTACK") {
      if (isDefender) {
        throw new Error("Gynejas negali atakuoti");
      }
      if (action.cardIndex < 0 || action.cardIndex >= actor.cards.length) {
        throw new Error("Invalid card index");
      }
      const card = actor.cards[action.cardIndex];
      if (round.pairs.length === 0) {
        if (actorPlayerId !== round.attackerId) {
          throw new Error("Pirma korta deda pagrindinis atakuotojas");
        }
        if (defender.cards.length === 0) {
          throw new Error("Gynejas neturi kortu");
        }
      } else {
        if (round.pairs.length >= round.attackLimit) {
          throw new Error("Pasiektas atakos limitas");
        }
        const undefended = round.pairs.filter((pair) => !pair.defense).length;
        if (!round.taking && undefended + 1 > defender.cards.length) {
          throw new Error("Gynejas neturi tiek kortu");
        }
        if (!this.durakTableRanks(round).has(card.rank)) {
          throw new Error("Korta netinka - reikia tokios vertes kaip ant stalo");
        }
      }
      actor.cards.splice(action.cardIndex, 1);
      round.pairs.push({ attack: card, defense: null });
      round.passes = 0;
      room.dealerLog.push(`${actor.name} atakuoja ${card.rank}${card.suit}`);
      if (round.taking) {
        this.durakAdvanceAttackers(room, round);
      } else {
        room.currentTurnPlayerId = round.defenderId;
        this.resetTurnTimer(room);
      }
      return;
    }

    if (action.type === "DURAK_DEFEND") {
      if (!isDefender || round.taking) {
        throw new Error("Ginasi gali tik gynejas");
      }
      const pair = round.pairs[action.pairIndex];
      if (!pair || pair.defense) {
        throw new Error("Netinkama atakos korta");
      }
      if (action.cardIndex < 0 || action.cardIndex >= actor.cards.length) {
        throw new Error("Invalid card index");
      }
      const card = actor.cards[action.cardIndex];
      if (!durakCanBeat(pair.attack, card, room.trumpSuit)) {
        throw new Error("Korta nenumusa atakos");
      }
      actor.cards.splice(action.cardIndex, 1);
      pair.defense = card;
      room.dealerLog.push(`${actor.name} atmusa ${pair.attack.rank}${pair.attack.suit} su ${card.rank}${card.suit}`);
      if (round.pairs.every((p) => p.defense)) {
        round.attackerPos = 0;
        round.passes = 0;
        this.durakAdvanceAttackers(room, round);
      }
      return;
    }

    if (action.type === "DURAK_TRANSFER") {
      if (!isDefender || round.taking) {
        throw new Error("Perkelti gali tik gynejas");
      }
      if (!round.pairs.every((p) => !p.defense)) {
        throw new Error("Perkelti galima tik dar niekam neatsakius");
      }
      if (action.cardIndex < 0 || action.cardIndex >= actor.cards.length) {
        throw new Error("Invalid card index");
      }
      const card = actor.cards[action.cardIndex];
      if (card.rank !== round.pairs[0].attack.rank) {
        throw new Error("Perkelti galima tokios pat vertes korta");
      }
      const next = this.durakNextActive(room, actorPlayerId);
      if (!next || next.cards.length < round.pairs.length + 1 || round.pairs.length + 1 > DURAK_HAND_SIZE) {
        throw new Error("Kitas zaidejas negali buti perkeltas - per mazai kortu");
      }
      actor.cards.splice(action.cardIndex, 1);
      round.pairs.push({ attack: card, defense: null });
      round.attackerId = actorPlayerId;
      round.defenderId = next.id;
      round.attackLimit = Math.min(DURAK_HAND_SIZE, next.cards.length);
      round.attackerOrder = this.durakOrderFrom(room, actorPlayerId)
        .filter((p) => p.id !== next.id)
        .map((p) => p.id);
      round.attackerPos = 0;
      round.passes = 0;
      room.currentTurnPlayerId = next.id;
      this.resetTurnTimer(room);
      room.dealerLog.push(`${actor.name} perkele ataka ${next.name}`);
      return;
    }

    if (action.type === "DURAK_TAKE") {
      if (!isDefender || round.taking) {
        throw new Error("Imti gali tik gynejas");
      }
      if (!round.pairs.some((p) => !p.defense)) {
        throw new Error("Nera ko imti");
      }
      round.taking = true;
      round.attackerPos = 0;
      round.passes = 0;
      room.dealerLog.push(`${actor.name} ims kortas`);
      this.durakAdvanceAttackers(room, round);
      return;
    }

    if (action.type === "DURAK_DONE") {
      if (isDefender) {
        throw new Error("Gynejas negali baigti atakos");
      }
      if (round.pairs.length === 0) {
        throw new Error("Pirma reikia atakuoti");
      }
      if (!round.taking && round.pairs.some((p) => !p.defense)) {
        throw new Error("Laukiama gynejo");
      }
      round.passes += 1;
      round.attackerPos = (round.attackerPos + 1) % Math.max(round.attackerOrder.length, 1);
      this.durakAdvanceAttackers(room, round);
      return;
    }

    throw new Error("Unsupported durak action");
  }

  // Boto/timeout sprendimas. timeout=true: paprasciausias saugus ejimas.
  private decideDurakAction(room: GameRoom, player: InternalPlayer, timeout: boolean): DurakAction {
    const round = room.durak;
    if (!round) {
      throw new Error("Durak raundas nepradetas");
    }
    const trump = room.trumpSuit;
    const byCost = (a: Card, b: Card): number => {
      const ta = a.suit === trump ? 100 : 0;
      const tb = b.suit === trump ? 100 : 0;
      return ta + RANK_ORDER[a.rank] - (tb + RANK_ORDER[b.rank]);
    };

    if (player.id === round.defenderId) {
      if (timeout) {
        return { type: "DURAK_TAKE" };
      }
      const pairIndex = round.pairs.findIndex((p) => !p.defense);
      const target = round.pairs[pairIndex];
      if (target) {
        // Perkelimas: tokios pat vertes ne koziris, kai kitas zaidejas turi pakankamai kortu.
        if (round.pairs.every((p) => !p.defense) && Math.random() < 0.5) {
          const next = this.durakNextActive(room, player.id);
          const idx = player.cards.findIndex((c) => c.rank === target.attack.rank && c.suit !== trump);
          if (idx >= 0 && next && next.cards.length >= round.pairs.length + 1 && round.pairs.length + 1 <= DURAK_HAND_SIZE) {
            return { type: "DURAK_TRANSFER", cardIndex: idx };
          }
        }
        const options = player.cards
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => durakCanBeat(target.attack, card, trump))
          .sort((a, b) => byCost(a.card, b.card));
        if (options.length > 0) {
          return { type: "DURAK_DEFEND", cardIndex: options[0].index, pairIndex };
        }
      }
      return { type: "DURAK_TAKE" };
    }

    if (round.pairs.length === 0) {
      const sorted = player.cards.map((card, index) => ({ card, index })).sort((a, b) => byCost(a.card, b.card));
      return { type: "DURAK_ATTACK", cardIndex: sorted[0]?.index ?? 0 };
    }

    if (timeout) {
      return { type: "DURAK_DONE" };
    }
    const ranks = this.durakTableRanks(round);
    const options = player.cards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => ranks.has(card.rank) && (card.suit !== trump || room.centerDeck.length === 0))
      .sort((a, b) => byCost(a.card, b.card));
    if (options.length > 0 && (round.taking || Math.random() < 0.7)) {
      return { type: "DURAK_ATTACK", cardIndex: options[0].index };
    }
    return { type: "DURAK_DONE" };
  }

  // -------------------------------------------------------------------------
  // 999 zaidimo logika
  // -------------------------------------------------------------------------

  // Po ejimo: papildo ranka is kalades iki 3 ir, rankai bei kaladei istustejus,
  // perkelia atverstas kortas i ranka.
  private nnnSettleZones(room: GameRoom, player: InternalPlayer): void {
    while (room.centerDeck.length > 0 && player.cards.length < NNN_HAND_SIZE) {
      const card = room.centerDeck.pop();
      if (!card) break;
      player.cards.push(card);
    }
    if (player.cards.length === 0 && room.centerDeck.length === 0 && player.faceUpCards.length > 0) {
      player.cards.push(...player.faceUpCards);
      player.faceUpCards = [];
      room.dealerLog.push(`${player.name} pasieme savo atverstas kortas i ranka`);
    }
  }

  private applyNnnAction(room: GameRoom, actorPlayerId: string, action: NnnAction): void {
    const actor = this.getPlayerOrThrow(room, actorPlayerId);

    if (action.type === "PLAY_CARDS") {
      this.nnnPlayCards(room, actor, action.cardIndexes);
      return;
    }
    if (action.type === "SHOW_THREE") {
      this.nnnShowThree(room, actor, action.cardIndex, action.targetPlayerId);
      return;
    }
    if (action.type === "TAKE_PILE") {
      this.nnnTakePile(room, actor);
      return;
    }
    if (action.type === "PLAY_BLIND") {
      this.nnnPlayBlind(room, actor, action.blindIndex);
      return;
    }
    throw new Error("Unsupported 999 action");
  }

  private nnnPlayCards(room: GameRoom, actor: InternalPlayer, cardIndexes: number[]): void {
    if (cardIndexes.length === 0) {
      throw new Error("Nepasirinkta ne viena korta");
    }
    const unique = [...new Set(cardIndexes)];
    if (unique.length !== cardIndexes.length) {
      throw new Error("Kartojasi kortu indeksai");
    }
    if (unique.some((i) => i < 0 || i >= actor.cards.length)) {
      throw new Error("Invalid card index");
    }
    const rank = actor.cards[unique[0]].rank;
    if (unique.some((i) => actor.cards[i].rank !== rank)) {
      throw new Error("Vienu metu galima desti tik tos pacios vertes kortas");
    }
    if (rank === "3") {
      throw new Error("Trejeto i kruva desti negalima - ji rodoma zaidejui");
    }
    const top = room.tableStack[room.tableStack.length - 1] ?? null;
    if (!canPlayOnNnnPile(top, rank)) {
      throw new Error("Korta netinka ant kruvos virsaus");
    }

    const played: Card[] = [];
    for (const i of [...unique].sort((a, b) => b - a)) {
      played.push(...actor.cards.splice(i, 1));
    }
    room.tableStack.push(...played);
    room.dealerLog.push(`${actor.name} padejo ${played.length} x ${rank}`);

    this.nnnResolveAfterPilePlay(room, actor, rank);
  }

  // Bendra pabaiga padejus korta(s) i kruva (is rankos arba akla).
  // 10 arba 4 vienodos virsuje sudegina kruva; 2 ir sudeginimas palieka
  // ejima tam paciam zaidejui.
  private nnnResolveAfterPilePlay(room: GameRoom, actor: InternalPlayer, rank: Rank): void {
    // 4 tos pacios vertes kortos kruvos virsuje (gali buti sudetos keliu
    // zaideju per kelis ejimus) veikia kaip 10.
    const top4 = room.tableStack.slice(-4);
    const fourOfAKind = top4.length === 4 && top4.every((c) => c.rank === top4[0].rank);
    const burns = rank === "10" || fourOfAKind;
    if (burns) {
      room.discardPile.push(...room.tableStack);
      room.tableStack = [];
      room.dealerLog.push(
        rank === "10" ? `${actor.name} sudegino kruva su 10` : `${actor.name} uzbaige 4 x ${rank} - kruva sudege`,
      );
    }
    this.nnnSettleZones(room, actor);
    this.checkNnnEnd(room);
    if (room.phase !== "PLAYING") {
      return;
    }
    const keepsTurn = (burns || rank === "2") && nnnTotalCards(actor) > 0;
    if (!keepsTurn) {
      this.advanceNnnTurn(room, actor.id);
    }
  }

  private nnnShowThree(room: GameRoom, actor: InternalPlayer, cardIndex: number, targetPlayerId: string): void {
    if (cardIndex < 0 || cardIndex >= actor.cards.length) {
      throw new Error("Invalid card index");
    }
    const card = actor.cards[cardIndex];
    if (card.rank !== "3") {
      throw new Error("Rodyti galima tik trejeta");
    }
    if (targetPlayerId === actor.id) {
      throw new Error("Negalima rodyti trejeto sau");
    }
    const target = this.getPlayerOrThrow(room, targetPlayerId);
    if (nnnTotalCards(target) === 0) {
      throw new Error("Sis zaidejas jau baige zaidima");
    }

    actor.cards.splice(cardIndex, 1);
    const targetCanDefend =
      target.cards.some((c) => c.rank === "3") || target.faceUpCards.some((c) => c.rank === "3");
    room.pendingThree = {
      showerPlayerId: actor.id,
      targetPlayerId,
      card,
      targetCanDefend,
    };
    room.dealerLog.push(`${actor.name} rodo trejeta zaidejui ${target.name}`);
  }

  // Taikinio atsakymas i parodyta trejeta. defend=false - taikinys pasiima
  // kruva; defend=true - atsimusa savo trejetu ir kruva pasiima rodytojas.
  public resolveThreeResponse(roomCode: string, targetPlayerId: string, defend: boolean): void {
    const room = this.getRoomOrThrow(roomCode);
    const pending = room.pendingThree;
    if (!pending) {
      throw new Error("Nera laukianco trejeto");
    }
    if (pending.targetPlayerId !== targetPlayerId) {
      throw new Error("Atsakyti gali tik zaidejas, kuriam parodytas trejetas");
    }
    const target = this.getPlayerOrThrow(room, targetPlayerId);
    const shower = room.players.find((p) => p.id === pending.showerPlayerId);

    if (defend) {
      let defenderThree: Card | null = null;
      const handIdx = target.cards.findIndex((c) => c.rank === "3");
      if (handIdx >= 0) {
        defenderThree = target.cards.splice(handIdx, 1)[0];
      } else {
        const faceUpIdx = target.faceUpCards.findIndex((c) => c.rank === "3");
        if (faceUpIdx >= 0) {
          defenderThree = target.faceUpCards.splice(faceUpIdx, 1)[0];
        }
      }
      if (!defenderThree) {
        throw new Error("Neturi trejeto atsimusti");
      }
      room.discardPile.push(pending.card, defenderThree);
      if (shower) {
        shower.cards.push(...room.tableStack);
        room.tableStack = [];
      }
      room.dealerLog.push(`${target.name} atsimuse trejetu - kruva pasiima rodytojas`);
    } else {
      room.discardPile.push(pending.card);
      target.cards.push(...room.tableStack);
      room.tableStack = [];
      room.dealerLog.push(`${target.name} pasiima kruva del parodyto trejeto`);
    }

    room.pendingThree = null;
    if (shower) {
      this.nnnSettleZones(room, shower);
    }
    this.nnnSettleZones(room, target);
    this.checkNnnEnd(room);
    if (room.phase === "PLAYING") {
      this.advanceNnnTurn(room, pending.showerPlayerId);
    }
  }

  private nnnTakePile(room: GameRoom, actor: InternalPlayer): void {
    if (room.tableStack.length === 0) {
      throw new Error("Kruva tuscia - reikia zaisti korta");
    }
    actor.cards.push(...room.tableStack);
    room.tableStack = [];
    room.dealerLog.push(`${actor.name} pasieme kruva`);
    this.advanceNnnTurn(room, actor.id);
  }

  private nnnPlayBlind(room: GameRoom, actor: InternalPlayer, blindIndex: number): void {
    if (actor.cards.length > 0 || actor.faceUpCards.length > 0) {
      throw new Error("Aklas kortas galima versti tik isnaudojus ranka ir atverstas");
    }
    if (blindIndex < 0 || blindIndex >= actor.blindCards.length) {
      throw new Error("Invalid blind card index");
    }

    const [flipped] = actor.blindCards.splice(blindIndex, 1);

    if (flipped.rank === "3") {
      // Akla 3 keliauja i ranka - zaidejas ja privalo parodyti (SHOW_THREE).
      actor.cards.push(flipped);
      room.dealerLog.push(`${actor.name} atverte akla trejeta - turi ji parodyti`);
      return;
    }

    const top = room.tableStack[room.tableStack.length - 1] ?? null;
    if (canPlayOnNnnPile(top, flipped.rank)) {
      room.tableStack.push(flipped);
      room.dealerLog.push(`${actor.name} atverte akla ${flipped.rank}${flipped.suit} - tinka`);
      this.nnnResolveAfterPilePlay(room, actor, flipped.rank);
      return;
    }

    actor.cards.push(...room.tableStack, flipped);
    room.tableStack = [];
    room.dealerLog.push(`${actor.name} atverte akla ${flipped.rank}${flipped.suit} - netinka, pasiima kruva`);
    this.advanceNnnTurn(room, actor.id);
  }

  // Ejimas kitam zaidejui, praleidziant jau baigusius (0 kortu visose zonose).
  private advanceNnnTurn(room: GameRoom, fromPlayerId: string): void {
    const idx = room.players.findIndex((p) => p.id === fromPlayerId);
    if (idx < 0) {
      return;
    }
    let next = (idx + 1) % room.players.length;
    let hops = 0;
    while (room.players[next] && nnnTotalCards(room.players[next]) === 0 && hops < room.players.length) {
      next = (next + 1) % room.players.length;
      hops += 1;
    }
    const nextPlayer = room.players[next] ?? null;
    room.currentTurnPlayerId = nextPlayer?.id ?? null;
    this.resetTurnTimer(room);
    if (nextPlayer) {
      this.nnnSettleZones(room, nextPlayer);
    }
  }

  private checkNnnEnd(room: GameRoom): void {
    const newlyFinished = room.players
      .filter((p) => nnnTotalCards(p) === 0)
      .map((p) => p.id)
      .filter((id) => !room.finalRankingPlayerIds.includes(id));
    room.finalRankingPlayerIds.push(...newlyFinished);

    const playersWithCards = room.players.filter((p) => nnnTotalCards(p) > 0);
    if (playersWithCards.length <= 1) {
      room.phase = "FINISHED";
      // Retas atvejis: abu paskutiniai baigia vienu metu (trejeto atsakymas) -
      // pralaimetoju laikomas paskutinis reitinge.
      room.loserPlayerId =
        playersWithCards[0]?.id ?? room.finalRankingPlayerIds[room.finalRankingPlayerIds.length - 1] ?? null;
      room.winnerPlayerIds = room.players.filter((p) => p.id !== room.loserPlayerId).map((p) => p.id);

      const nonLoserIds = room.players.filter((p) => p.id !== room.loserPlayerId).map((p) => p.id);
      const trackedNonLosers = room.finalRankingPlayerIds.filter((id) => id !== room.loserPlayerId);
      const missingNonLosers = nonLoserIds.filter((id) => !trackedNonLosers.includes(id));
      room.finalRankingPlayerIds = [...trackedNonLosers, ...missingNonLosers];
      if (room.loserPlayerId) {
        room.finalRankingPlayerIds.push(room.loserPlayerId);
      }
      room.lastChampionPlayerId = room.finalRankingPlayerIds[0] ?? null;
      room.dealerLog.push("999 zaidimas baigtas");
      room.currentTurnPlayerId = null;
      this.resetTurnTimer(room);
      room.pendingThree = null;
      this.applyMatchRewards(room);
    }
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
      this.resetTurnTimer(room);
      this.applyMatchRewards(room);
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
    this.resetTurnTimer(room);
    room.dealerLog.push("Moved to playing phase");
  }

  private reconcilePendingFasiolas(room: GameRoom): void {
    const pending = room.pendingFasiolas;
    if (!pending) {
      return;
    }

    const validRequiredFromPlayerIds = pending.requiredFromPlayerIds.filter((playerId) => {
      const contributor = room.players.find((p) => p.id === playerId);
      return Boolean(contributor && contributor.cards.length > 0);
    });

    pending.requiredFromPlayerIds = validRequiredFromPlayerIds;
    pending.contributedFromPlayerIds = pending.contributedFromPlayerIds.filter((playerId) =>
      validRequiredFromPlayerIds.includes(playerId),
    );

    if (pending.contributedFromPlayerIds.length !== pending.requiredFromPlayerIds.length) {
      return;
    }

    const accused = room.players.find((p) => p.id === pending.accusedPlayerId);
    if (!accused) {
      room.pendingFasiolas = null;
      room.pendingFasiolasCards = new Map();
      room.dealerLog.push("Fasiolas auto-cleared (accused not found)");
      return;
    }

    for (const contributorId of pending.requiredFromPlayerIds) {
      const contributedCard = room.pendingFasiolasCards.get(contributorId);
      if (contributedCard) {
        accused.cards.unshift(contributedCard);
      }
    }

    room.pendingFasiolas = null;
    room.pendingFasiolasCards = new Map();
    room.dealerLog.push("Fasiolas auto-resolved");
  }

  private advanceTurn(room: GameRoom): void {
    if (!room.currentTurnPlayerId) {
      return;
    }
    const idx = room.players.findIndex((p) => p.id === room.currentTurnPlayerId);
    if (idx < 0) {
      return;
    }

    let next = (idx + 1) % room.players.length;
    if (room.phase === "PLAYING") {
      // PLAYING fazeje be korteliu like zaidejai praleidziami (jie jau baige).
      let hops = 0;
      while (room.players[next] && room.players[next].cards.length === 0 && hops < room.players.length) {
        next = (next + 1) % room.players.length;
        hops += 1;
      }
    }
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
    this.resetTurnTimer(room);
  }

  private applyMatchRewards(room: GameRoom): void {
    if (!room.loserPlayerId && room.finalRankingPlayerIds.length === 0) {
      return;
    }

    // Vietos pagal realia baigimo tvarka, ne pagal sedejimo eile.
    const ranked = room.finalRankingPlayerIds.filter((id) => room.players.some((p) => p.id === id));
    const missing = room.players.map((p) => p.id).filter((id) => !ranked.includes(id));
    const standings = [...ranked, ...missing];

    const rewardRecords: MatchRewardRecord[] = [];

    standings.forEach((playerId, index) => {
      const account = this.getAccountOrThrow(playerId);
      const placement = index + 1;
      const reward = BASE_POINTS_PER_GAME + (PLACEMENT_BONUS[placement] ?? 0);
      const won = placement === 1;
      account.gamesPlayed += 1;
      account.points += reward;
      if (won) {
        account.gamesWon = (account.gamesWon ?? 0) + 1;
      } else {
        account.gamesLost = (account.gamesLost ?? 0) + 1;
      }

      const player = room.players.find((p) => p.id === playerId);
      rewardRecords.push({
        playerId,
        authUserId: player?.authUserId ?? null,
        placement,
        reward,
        won,
      });
    });

    room.matchRewards = rewardRecords;
    this.matchRewardsListener?.(rewardRecords);
  }

  private ensureAccount(playerId: string, profile: PlayerProfile, options?: { registeredAt?: number }): void {
    const account = this.playerAccounts.get(playerId) ?? createDefaultAccountState();
    if (typeof options?.registeredAt === "number" && options.registeredAt > 0) {
      account.registeredAt = options.registeredAt;
    } else if (!account.registeredAt) {
      account.registeredAt = Date.now();
    }
    this.unlockProfileItems(account, profile);
    this.playerAccounts.set(playerId, account);
  }

  private getAccountOrThrow(playerId: string): PlayerAccountState {
    const account = this.playerAccounts.get(playerId);
    if (!account) {
      throw new Error("Account not found");
    }
    return account;
  }

  private canUseProfileItems(account: PlayerAccountState, profile: PlayerProfile): boolean {
    return (
      account.unlocked.avatars.includes(profile.avatarId) &&
      account.unlocked.hats.includes(profile.hatId) &&
      account.unlocked.skins.includes(profile.skinId) &&
      account.unlocked.effects.includes(profile.effectId) &&
      account.unlocked.backgrounds.includes(profile.cardBackgroundId) &&
      account.unlocked.tables.includes(profile.tableId)
    );
  }

  private unlockProfileItems(account: PlayerAccountState, profile: PlayerProfile): void {
    account.unlocked.avatars = uniqueItems([...account.unlocked.avatars, profile.avatarId]);
    account.unlocked.hats = uniqueItems([...account.unlocked.hats, profile.hatId]);
    account.unlocked.skins = uniqueItems([...account.unlocked.skins, profile.skinId]);
    account.unlocked.effects = uniqueItems([...account.unlocked.effects, profile.effectId]);
    account.unlocked.backgrounds = uniqueItems([...account.unlocked.backgrounds, profile.cardBackgroundId]);
    account.unlocked.tables = uniqueItems([...account.unlocked.tables, profile.tableId]);
  }

  private isItemUnlocked(account: PlayerAccountState, type: ShopItemType, itemId: ShopItemId): boolean {
    if (type === "avatar") {
      return account.unlocked.avatars.includes(itemId as AvatarId);
    }
    if (type === "hat") {
      return account.unlocked.hats.includes(itemId as HatId);
    }
    if (type === "skin") {
      return account.unlocked.skins.includes(itemId as SkinId);
    }
    if (type === "background") {
      return account.unlocked.backgrounds.includes(itemId as CardBackgroundId);
    }
    if (type === "table") {
      return account.unlocked.tables.includes(itemId as TableId);
    }
    return account.unlocked.effects.includes(itemId as EffectId);
  }

  private unlockItem(account: PlayerAccountState, type: ShopItemType, itemId: ShopItemId): void {
    if (type === "avatar") {
      account.unlocked.avatars = uniqueItems([...account.unlocked.avatars, itemId as AvatarId]);
      return;
    }
    if (type === "hat") {
      account.unlocked.hats = uniqueItems([...account.unlocked.hats, itemId as HatId]);
      return;
    }
    if (type === "skin") {
      account.unlocked.skins = uniqueItems([...account.unlocked.skins, itemId as SkinId]);
      return;
    }
    if (type === "background") {
      account.unlocked.backgrounds = uniqueItems([...account.unlocked.backgrounds, itemId as CardBackgroundId]);
      return;
    }
    if (type === "table") {
      account.unlocked.tables = uniqueItems([...account.unlocked.tables, itemId as TableId]);
      return;
    }
    account.unlocked.effects = uniqueItems([...account.unlocked.effects, itemId as EffectId]);
  }

  private getRoomOrThrow(roomCode: string): GameRoom {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new Error("Room not found");
    }
    // ponytail: aktyvumas zymimas kiekviename kreipinyje (iskaitant skaitymus
    // po veiksmu) - to pakanka sweep'ui, atskiru bump'u nereikia.
    room.lastActivityAt = Date.now();
    return room;
  }

  // Zaidejas samoningai palieka kambari (mygtukas "Grizti i main menu").
  public leaveRoom(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode);
    const player = room?.players.find((p) => p.id === playerId);
    if (!room || !player) {
      return;
    }
    if (room.phase === "DEALING" || room.phase === "PLAYING") {
      if (!player.isBot) {
        player.isBot = true;
        player.wasHuman = true;
        player.connected = false;
        room.dealerLog.push(`${player.name} paliko zaidima - toliau zaidzia botas`);
        this.kickBots(roomCode);
      }
    } else {
      room.players = room.players.filter((p) => p.id !== playerId);
      room.dealerLog.push(`${player.name} paliko kambari`);
    }
    if (!room.players.some((p) => !p.isBot)) {
      this.destroyRoom(roomCode);
    }
  }

  // Rematch: FINISHED kambarys grazinamas i LOBBY. Islieka zmones ir tikri
  // botai; wasHuman botai (atsijunge/isseje zaidejai) ismetami.
  public rematch(roomCode: string): void {
    const room = this.getRoomOrThrow(roomCode);
    if (room.phase !== "FINISHED") {
      throw new Error("Rematch galimas tik pasibaigus zaidimui");
    }
    const dropped = room.players.filter((p) => p.wasHuman || (!p.isBot && !p.connected));
    room.players = room.players.filter((p) => !dropped.includes(p));
    for (const p of dropped) {
      this.playerAccounts.delete(p.id);
    }
    for (const p of room.players) {
      p.cards = [];
      p.faceUpCards = [];
      p.blindCards = [];
    }
    room.phase = "LOBBY";
    room.centerDeck = [];
    room.revealedDrawCard = null;
    room.tableStack = [];
    room.currentTurnPlayerId = null;
    room.turnStartedAt = null;
    room.lastNonSpadeDrawnSuit = null;
    room.trumpSuit = null;
    room.winnerPlayerIds = [];
    room.loserPlayerId = null;
    room.finalRankingPlayerIds = [];
    room.pendingFasiolas = null;
    room.pendingFasiolasCards = new Map();
    room.lastAction = null;
    room.matchRewards = null;
    room.discardPile = [];
    room.pendingThree = null;
    room.durak = null;
    // gameType ir lastChampionPlayerId ISLIEKA - cempionas pradeda kita maca.
    room.dealerLog = ["Naujas zaidimas - laukiame pradzios"];
  }

  public destroyRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return;
    }
    const botTimer = this.botTimers.get(roomCode);
    if (botTimer) {
      clearTimeout(botTimer);
      this.botTimers.delete(roomCode);
    }
    for (const [key, timer] of this.disconnectTimers) {
      if (key.startsWith(`${roomCode}:`)) {
        clearTimeout(timer);
        this.disconnectTimers.delete(key);
      }
    }
    for (const p of room.players) {
      this.playerAccounts.delete(p.id);
    }
    this.rooms.delete(roomCode);
  }

  // Apleistu kambariu valymas; grazina sunaikintu kambariu kodus.
  public sweepRooms(): string[] {
    const now = Date.now();
    const finishedTtl = Number(process.env.FINISHED_ROOM_TTL_MS ?? 5 * 60 * 1000);
    const lobbyTtl = Number(process.env.LOBBY_ROOM_TTL_MS ?? 60 * 60 * 1000);
    const destroyed: string[] = [];
    for (const room of this.rooms.values()) {
      const idleMs = now - room.lastActivityAt;
      const hasConnectedHuman = room.players.some((p) => !p.isBot && p.connected);
      const expired =
        (room.phase === "FINISHED" && idleMs > finishedTtl) ||
        (room.phase === "LOBBY" && idleMs > lobbyTtl) ||
        (!hasConnectedHuman && idleMs > finishedTtl);
      if (expired) {
        destroyed.push(room.code);
      }
    }
    for (const code of destroyed) {
      this.destroyRoom(code);
    }
    return destroyed;
  }

  private getPlayerOrThrow(room: GameRoom, playerId: string): InternalPlayer {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error("Player not found");
    }
    return player;
  }
}
