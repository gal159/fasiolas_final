// Durak (perevodnoy) variklio simuliacija: daug pilnu partiju su botais iki FINISHED,
// abiem kalades dydziais (52 ir 32) + kortu apskaitos invariantas.
// Paleidimas: npx tsx scripts/test-durak-engine.ts
import { GameEngine } from "../src/gameEngine";
import type { DeckSize } from "../../shared/src/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERT: ${message}`);
  }
}

type AnyRoom = {
  phase: string;
  finalRankingPlayerIds: string[];
  loserPlayerId: string | null;
  matchRewards: unknown[] | null;
  players: { id: string; isBot: boolean; cards: unknown[] }[];
  tableStack: unknown[];
  centerDeck: unknown[];
  discardPile: unknown[];
  durak: { pairs: { attack: unknown; defense: unknown | null }[] } | null;
};

type AnyEngine = {
  performOneBotAction: (code: string) => boolean;
  rooms: Map<string, AnyRoom>;
};

let totalGames = 0;
let draws = 0;

function runOneMatch(playerCount: number, deckSize: DeckSize): void {
  const engine = new GameEngine();
  const { roomCode, playerId: hostId } = engine.createRoom("Testeris", "sock-host", undefined, {
    gameType: "durak",
    deckSize,
  });
  const maxPlayers = deckSize === "short" ? 5 : 6;
  for (let i = 0; i < playerCount - 1; i += 1) {
    engine.addBot(roomCode);
  }
  if (playerCount === maxPlayers) {
    let threw = false;
    try {
      engine.addBot(roomCode);
    } catch {
      threw = true;
    }
    assert(threw, `${maxPlayers + 1}-as zaidejas Durak (${deckSize}) turi buti atmestas`);
  }

  engine.startGame(roomCode);
  const state = engine.getClientState(roomCode, hostId);
  assert(state.state.gameType === "durak", "gameType turi buti durak");
  assert(state.state.deckSize === deckSize, "deckSize perduodamas klientui");
  assert(state.state.phase === "PLAYING", "Durak startuoja i PLAYING");
  assert(state.yourHand.length === 6, "rankoje 6 kortos");
  for (const p of state.state.players) {
    assert(p.topCard === null, "Durak topCard niekada nesiunciamas");
  }
  const deckTotal = deckSize === "short" ? 32 : 52;
  assert(state.state.centerDeckCount === deckTotal - playerCount * 6, "kalades kiekis po dalinimo");
  assert(state.state.trumpSuit !== null, "koziris nustatytas");
  assert(state.state.durak?.trumpCard !== null, "kozirio korta matoma");

  const anyEngine = engine as unknown as AnyEngine;
  const room = anyEngine.rooms.get(roomCode) as AnyRoom;
  room.players.find((p) => p.id === hostId)!.isBot = true;

  let guard = 0;
  while (room.phase === "PLAYING") {
    guard += 1;
    assert(guard < 20000, "partija uzstrigo (guard)");
    const acted = anyEngine.performOneBotAction(roomCode);
    assert(acted, `botas neturi ka veikti, nors PLAYING (guard=${guard})`);

    // Invariantas kiekviename zingsnyje: visos kortos is kalades yra kur nors.
    const inHands = room.players.reduce((sum, p) => sum + p.cards.length, 0);
    const onTable = (room.durak?.pairs ?? []).reduce((sum, pair) => sum + (pair.defense ? 2 : 1), 0);
    const total = inHands + onTable + room.centerDeck.length + room.discardPile.length;
    assert(total === deckTotal, `kortu apskaita: ${total} != ${deckTotal}`);
  }

  assert(room.phase === "FINISHED", "partija baigesi FINISHED");
  assert(room.finalRankingPlayerIds.length === room.players.length, "reitinge visi zaidejai");
  assert(new Set(room.finalRankingPlayerIds).size === room.players.length, "reitinge nera dublikatu");
  assert(Boolean(room.matchRewards && room.matchRewards.length === room.players.length), "rewards visiems");
  if (room.loserPlayerId) {
    assert(
      room.finalRankingPlayerIds[room.finalRankingPlayerIds.length - 1] === room.loserPlayerId,
      "durnius paskutinis reitinge",
    );
  } else {
    draws += 1;
  }

  totalGames += 1;
  engine.rematch(roomCode);
  engine.startGame(roomCode);
  assert(room.phase === "PLAYING", "rematch startuoja");
  engine.destroyRoom(roomCode);
}

for (const deckSize of ["full", "short"] as DeckSize[]) {
  const maxPlayers = deckSize === "short" ? 5 : 6;
  for (let n = 2; n <= maxPlayers; n += 1) {
    for (let i = 0; i < 40; i += 1) {
      runOneMatch(n, deckSize);
    }
  }
}

// Bendra kalades dydzio patikra: Fasiolas ir 999 su 7..A.
for (const gameType of ["fasiolas", "nnn"] as const) {
  const engine = new GameEngine();
  const { roomCode } = engine.createRoom("T", "s", undefined, { gameType, deckSize: "short" });
  engine.addBot(roomCode);
  engine.startGame(roomCode);
  const room = (engine as unknown as AnyEngine).rooms.get(roomCode) as AnyRoom;
  const dealt = room.players.reduce((sum, p) => sum + p.cards.length, 0);
  const deckLeft = room.centerDeck.length;
  const faceUp = room.players.reduce(
    (sum, p) => sum + ((p as unknown as { faceUpCards: unknown[] }).faceUpCards?.length ?? 0),
    0,
  );
  const blind = room.players.reduce(
    (sum, p) => sum + ((p as unknown as { blindCards: unknown[] }).blindCards?.length ?? 0),
    0,
  );
  assert(dealt + deckLeft + faceUp + blind === 32, `${gameType} short kaladeje turi buti 32 kortos`);
  const cards = [...room.centerDeck, ...room.players.flatMap((p) => p.cards)] as { rank: string }[];
  assert(cards.every((c) => c.rank !== "2" && c.rank !== "3" && c.rank !== "4" && c.rank !== "5" && c.rank !== "6"), `${gameType} short be 2..6`);
}
{
  let threw = false;
  const engine = new GameEngine();
  const { roomCode } = engine.createRoom("T", "s", undefined, { gameType: "nnn", deckSize: "short" });
  for (let i = 0; i < 2; i += 1) engine.addBot(roomCode);
  try {
    engine.addBot(roomCode);
  } catch {
    threw = true;
  }
  assert(threw, "999 su 7..A kalade leidzia ne daugiau kaip 3 zaidejus");
}

console.log(`OK: ${totalGames} Durak partiju (lygiosios: ${draws}), kalades full/short, Fasiolas/999 short patikra`);
