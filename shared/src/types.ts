export type Suit = "S" | "H" | "D" | "C";

export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GamePhase = "LOBBY" | "DEALING" | "PLAYING" | "FINISHED";

export interface PublicPlayerState {
  id: string;
  name: string;
  cardCount: number;
  topCard: Card | null;
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
}
