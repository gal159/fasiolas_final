export type Suit = "S" | "H" | "D" | "C";

export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GamePhase = "LOBBY" | "DEALING" | "PLAYING" | "FINISHED";

export const PROFILE_COLOR_OPTIONS = [
  "#ff2f92",
  "#338bff",
  "#ffd54f",
  "#d0d8e8",
  "#53dc5b",
  "#8a3ffc",
  "#ff7a21",
  "#14b8a6",
] as const;

export const AVATAR_OPTIONS = ["zeus", "warrior", "mage", "ronin", "guardian"] as const;

export const HAT_OPTIONS = ["none", "cowboy", "horns", "visor", "winter", "antenna"] as const;

export const SKIN_OPTIONS = ["default", "striped", "chrome", "neon", "carbon", "frost"] as const;

export const EFFECT_OPTIONS = ["none", "outline", "glow", "fire", "shadow", "trail"] as const;

export const PROFILE_SLOT_OPTIONS = ["A", "B", "C"] as const;

export type ProfileColor = (typeof PROFILE_COLOR_OPTIONS)[number];
export type AvatarId = (typeof AVATAR_OPTIONS)[number];
export type HatId = (typeof HAT_OPTIONS)[number];
export type SkinId = (typeof SKIN_OPTIONS)[number];
export type EffectId = (typeof EFFECT_OPTIONS)[number];
export type ProfileSlot = (typeof PROFILE_SLOT_OPTIONS)[number];

export const RARITY_OPTIONS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;

export type RarityId = (typeof RARITY_OPTIONS)[number];

export const RARITY_PRICES: Record<RarityId, number> = {
  common: 0,
  uncommon: 100,
  rare: 250,
  epic: 1000,
  legendary: 5000,
  mythic: 10000,
};

export type ShopItemType = "avatar" | "hat" | "skin" | "effect";

export type ShopItemId = AvatarId | HatId | SkinId | EffectId;

export const AVATAR_RARITY: Record<AvatarId, RarityId> = {
  zeus: "legendary",
  warrior: "common",
  mage: "common",
  ronin: "common",
  guardian: "rare",
};

export const HAT_RARITY: Record<HatId, RarityId> = {
  none: "common",
  cowboy: "uncommon",
  horns: "rare",
  visor: "epic",
  winter: "legendary",
  antenna: "mythic",
};

export const SKIN_RARITY: Record<SkinId, RarityId> = {
  default: "common",
  striped: "uncommon",
  chrome: "rare",
  neon: "epic",
  carbon: "legendary",
  frost: "mythic",
};

export const EFFECT_RARITY: Record<EffectId, RarityId> = {
  none: "common",
  trail: "uncommon",
  outline: "rare",
  glow: "epic",
  shadow: "legendary",
  fire: "mythic",
};

export interface PlayerProfile {
  baseColor: ProfileColor;
  avatarId: AvatarId;
  hatId: HatId;
  skinId: SkinId;
  effectId: EffectId;
  profileSlot: ProfileSlot;
}

export interface PlayerUnlocks {
  avatars: AvatarId[];
  hats: HatId[];
  skins: SkinId[];
  effects: EffectId[];
}

export interface PlayerAccountState {
  points: number;
  gamesPlayed: number;
  unlocked: PlayerUnlocks;
}

export interface ShopCatalogItem {
  type: ShopItemType;
  id: ShopItemId;
  rarity: RarityId;
  cost: number;
}

export interface PublicPlayerState {
  id: string;
  name: string;
  cardCount: number;
  topCard: Card | null;
  profile: PlayerProfile;
}

export interface PublicTableState {
  phase: GamePhase;
  roomCode: string;
  currentTurnPlayerId: string | null;
  players: PublicPlayerState[];
  centerDeckCount: number;
  revealedDrawCard: Card | null;
  tableStack: Card[];
  trumpSuit: Suit | null;
  dealerLog: string[];
  winnerPlayerIds: string[];
  loserPlayerId: string | null;
  finalRankingPlayerIds: string[];
  pendingFasiolas: PendingFasiolasState | null;
}

export interface PendingFasiolasState {
  accusedPlayerId: string;
  requiredFromPlayerIds: string[];
  contributedFromPlayerIds: string[];
}

export type DealingAction =
  | {
      type: "MOVE_VISIBLE_CARD";
      toPlayerId: string;
    }
  | {
      type: "DRAW_REVEAL";
    }
  | {
      type: "PLACE_REVEALED";
      toPlayerId: string;
    }
  | {
      type: "END_TURN";
    };

export type PlayingAction =
  | {
      type: "PLAY_CARD";
      cardIndex: number;
    }
  | {
      type: "TAKE_OLDEST";
    };

export type TurnAction = DealingAction | PlayingAction;

export interface ClientStatePayload {
  state: PublicTableState;
  yourPlayerId: string;
  yourHand: Card[];
  account: PlayerAccountState;
}
