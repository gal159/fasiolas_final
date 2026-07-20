// 999 variklio simuliacija: daug pilnu partiju su botais iki FINISHED.
// Paleidimas: npx tsx scripts/test-nnn-engine.ts
import { GameEngine } from "../src/gameEngine";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERT: ${message}`);
  }
}

let totalGames = 0;
let totalRematches = 0;

function runOneMatch(playerCounts: number): void {
  const engine = new GameEngine();
  const { roomCode, playerId: hostId } = engine.createRoom("Testeris", "sock-host", undefined, {
    gameType: "nnn",
  });

  for (let i = 0; i < playerCounts - 1; i += 1) {
    engine.addBot(roomCode);
  }

  // Limitu patikra: 6-tas zaidejas nebetelpa.
  if (playerCounts === 5) {
    let threw = false;
    try {
      engine.addBot(roomCode);
    } catch {
      threw = true;
    }
    assert(threw, "6-tas zaidejas 999 kambaryje turi buti atmestas");
  }

  engine.startGame(roomCode);

  let state = engine.getClientState(roomCode, hostId);
  assert(state.state.gameType === "nnn", "gameType turi buti nnn");
  assert(state.state.phase === "PLAYING", "999 startuoja tiesiai i PLAYING");
  assert(state.yourHand.length === 3, "rankoje 3 kortos");
  for (const p of state.state.players) {
    assert((p.faceUpCards?.length ?? 0) === 3, "3 atverstos kortos");
    assert(p.blindCount === 3, "3 aklos kortos");
    assert(p.topCard === null, "999 topCard niekada nesiunciamas (rankos slaptos)");
  }
  const dealt = playerCounts * 9;
  assert(state.state.centerDeckCount === 52 - dealt, `kaladeje ${52 - dealt} kortu`);

  // Testui hosta paverciame botu tiesiogiai (leaveRoom sunaikintu kambari be
  // zmoniu) ir partija varome sinchroniskai per performOneBotAction refleksija
  // (kickBots naudoja setTimeout - realiu taimeriu laukti butu leta).
  const anyEngine = engine as unknown as {
    performOneBotAction: (code: string) => boolean;
    rooms: Map<string, { phase: string; finalRankingPlayerIds: string[]; loserPlayerId: string | null; lastChampionPlayerId: string | null; matchRewards: unknown[] | null; players: { id: string }[]; discardPile: unknown[]; tableStack: unknown[]; centerDeck: unknown[] }>;
  };

  let guard = 0;
  const room = anyEngine.rooms.get(roomCode);
  assert(Boolean(room), "kambarys egzistuoja");
  const hostPlayer = (room as unknown as { players: { id: string; isBot: boolean }[] }).players.find(
    (p) => p.id === hostId,
  );
  assert(Boolean(hostPlayer), "hostas kambaryje");
  hostPlayer!.isBot = true;
  while (room!.phase === "PLAYING") {
    guard += 1;
    assert(guard < 20000, "partija uzstrigo (guard)");
    const acted = anyEngine.performOneBotAction(roomCode);
    assert(acted, `botas neturi ka veikti, nors PLAYING (guard=${guard})`);
  }

  assert(room!.phase === "FINISHED", "partija baigesi FINISHED");
  assert(
    room!.finalRankingPlayerIds.length === room!.players.length,
    `reitinge visi zaidejai (${room!.finalRankingPlayerIds.length}/${room!.players.length})`,
  );
  assert(new Set(room!.finalRankingPlayerIds).size === room!.finalRankingPlayerIds.length, "reitinge nera dublikatu");
  assert(room!.loserPlayerId !== null, "yra pralaimetojas");
  assert(room!.lastChampionPlayerId === room!.finalRankingPlayerIds[0], "cempionas = 1 vieta");
  assert(Boolean(room!.matchRewards && room!.matchRewards.length === room!.players.length), "rewards visiems");

  // Kortu apskaita: 52 = zaideju zonos + kruva + kalade + discard.
  const anyRoom = room as unknown as {
    players: { cards: unknown[]; faceUpCards: unknown[]; blindCards: unknown[] }[];
    tableStack: unknown[];
    centerDeck: unknown[];
    discardPile: unknown[];
  };
  const inZones = anyRoom.players.reduce(
    (sum, p) => sum + p.cards.length + p.faceUpCards.length + p.blindCards.length,
    0,
  );
  const total = inZones + anyRoom.tableStack.length + anyRoom.centerDeck.length + anyRoom.discardPile.length;
  assert(total === 52, `kortu apskaita: ${total} != 52`);

  totalGames += 1;

  // Rematch: gameType ir cempionas islieka, kitas macas prasideda nuo cempiono.
  if (totalGames % 10 === 0) {
    engine.rematch(roomCode);
    assert(room!.phase === "LOBBY", "po rematch - LOBBY");
    const championBefore = room!.lastChampionPlayerId;
    engine.startGame(roomCode);
    assert(room!.phase === "PLAYING", "rematch startuoja i PLAYING");
    const anyRoom2 = room as unknown as { currentTurnPlayerId: string | null };
    if (championBefore && room!.players.some((p) => p.id === championBefore)) {
      assert(anyRoom2.currentTurnPlayerId === championBefore, "rematch pradeda cempionas");
    }
    let guard2 = 0;
    while (room!.phase === "PLAYING") {
      guard2 += 1;
      assert(guard2 < 20000, "rematch partija uzstrigo");
      anyEngine.performOneBotAction(roomCode);
    }
    assert(room!.phase === "FINISHED", "rematch partija baigesi");
    totalRematches += 1;
  }

  engine.destroyRoom(roomCode);
}

const GAMES = 200;
for (let i = 0; i < GAMES; i += 1) {
  const playerCounts = 2 + (i % 4); // 2..5 zaideju
  runOneMatch(playerCounts);
}

console.log(`OK: ${totalGames} partiju (${totalRematches} rematch'u) suzaista iki FINISHED be klaidu.`);
