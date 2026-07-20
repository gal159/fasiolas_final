# Fasiolas — gairės Claude Code

Realaus laiko daugelio žaidėjų kortų žaidimai (Fasiolas ir "999"). Monorepo: `client` (React + Vite),
`server` (Express + Socket.IO), `shared` (bendri tipai). Deploy: Vercel (client)
+ Render (server) + Neon Postgres (produkcijos DB). Vartotojas bendrauja lietuviškai.

## Komandos

```bash
# Serveris (port 3001)
cd server && npm run dev            # tsx BE watch - po kodo pakeitimu restartuok ranka!
npx tsc -p tsconfig.json --noEmit   # typecheck
npx tsx scripts/test-postgres-store.ts   # Postgres store testai (pg-mem)

# Klientas (port 5173)
cd client && npm run dev
npx tsc -b --force                  # typecheck
npx vite build                      # pries kiekviena commit
```

Testu framework'o nera — verifikacija per Playwright skriptus (playwright yra
client/node_modules) ir socket.io-client botus. E2E sablonas: registruok nauja
vartotoja -> prisijunk -> `Testi i zaidimo centra` -> veiksmai. Pilnam zaidimui
iki pabaigos naudok socket botus (DRAW_REVEAL/PLACE_REVEALED cikle, PLAYING
fazeje bandyk PLAY_CARD 0..n, fallback TAKE_OLDEST).

## Architektūra

- `client/src/App.tsx` — VISAS UI viename faile (~3000 eil.): auth, veikejo
  pasirinkimas (profileOnboardingPage), hub, Marketplace (renderMarketplacePanel),
  stalo langas (tableWindowOverlay). Busena: `account` (is auth DB per
  /auth/bootstrap), `payload` (zaidimo state is socket state_sync).
- `client/src/App.css` — ~8000 eil. SVARBU: failas turi KELIS temos sluoksnius,
  pridetus istoriskai vienas ant kito; velesnes taisykles su `!important`
  perraso ankstesnes. Pries stilizuojant grep'ink VISUS selektoriaus
  pasikartojimus. Pilno ekrano fonu sablonas: `.page.authPage` (su !important).
- `server/src/server.ts` — REST (`/auth/*`, `/admin/grant-points` su
  `X-App-Secret`) + Socket.IO handleriai + auth store pasirinkimas.
- `server/src/authUserStore.ts` — `AuthUserStore` sasaja: `DATABASE_URL` yra ->
  Postgres (JSONB doc + indeksuoti email/reset stulpeliai), nera -> NeDB failas
  (`DATA_DIR/auth-users.db` arba `server/data/auth-users.db`).
- `server/src/gameEngine.ts` — zaidimo taisykles, kambariai ir ju paskyros
  ATMINTYJE. Zaidimo pabaigoje `applyMatchRewards` (vietos pagal
  `finalRankingPlayerIds`) -> `setMatchRewardsListener` server.ts persistina
  i auth DB.
- `shared/src/types.ts` — OPTIONS/RARITY/PRICES konstantos ir tipai. Nauja
  kosmetika PRADEDAMA cia.

## Žaidimo tipai (gameType)

- Kambarys turi `gameType: "fasiolas" | "nnn"` ("nnn" = 999, Shithead stiliaus).
  Pasirenkamas jungikliu hub'e (`gameSwitch`), keliauja `create_room` payload'u
  (zod default `"fasiolas"` senu klientu suderinamumui) -> `GameRoom.gameType` ->
  `LobbySummary`/`PublicTableState`.
- 999 praleidzia DEALING faze (dalinimas 3 aklos + 3 atverstos + 3 i ranka vyksta
  `startNnnGame` viduje, iskart PLAYING). Max 5 zaidejai (`maxPlayersFor`).
- 999 busena variklyje: `discardPile`, `pendingThree` (parodyto trejeto laukimas,
  atsakymas per atskira socket eventa `respond_three`, ne TurnAction — atsako ne
  ejimo savininkas), `lastChampionPlayerId` (islieka per rematch, cempionas pradeda).
- KRITISKA: `getClientState` nnn kambariams siuncia `topCard: null` — rankos
  slaptos. 7 apribojimas isvedamas is kruvos virsaus (jokio flag'o). Ejimu
  praleidimas pagal `nnnTotalCards` (ranka+atverstos+aklos), ne pagal ranka.
- Variklio simuliacija: `npx tsx scripts/test-nnn-engine.ts` (200 partiju su
  botais iki FINISHED + kortu apskaitos invariantas 52).

## Kaip pridėti naują kosmetikos tipą (patikrintas receptas)

1. `shared/src/types.ts`: `X_OPTIONS`, `X_RARITY`, `TableId`-tipo aliasas,
   `ShopItemType` union, `PlayerProfile` laukas, `PlayerUnlocks` masyvas.
2. `server/src/server.ts`: `profileSchema` (`.optional().default(...)` senu
   klientu suderinamumui), `createDefaultProfile`, `normalizeProfile`,
   `createDefaultAccount`, `normalizeAccount`, `hydrateAuthUser.needsUpdate`
   (kad seni DB irasai hidratuotusi), purchase schemos enum, shop helperiai
   (`isValidShopItem`/`resolveItemCost`/`isItemUnlocked`/`unlockItem`).
3. `server/src/gameEngine.ts`: TIE PATYS shop helperiai dubliuoti cia +
   `getShopCatalog`, `createDefaultProfile`, `createDefaultUnlocks`,
   `cloneAccountState`, `canUseProfileItems`, `unlockProfileItems`.
4. `client/src/App.tsx`: LABELS, `SHOP_SECTION_ORDER/LABELS/ITEM_LABELS`,
   `createEmptyAccount`, `normalizeAccountState`, `createDefaultProfile`,
   `isPlayerProfile`, `normalizeLegacyProfile`, `itemOwned`, `itemCost`,
   `isItemEquipped`, `equipOwnedItem`, `shopByType` grouped objektas,
   preview klase `renderMarketplacePanel` (zr. `previewClass`).

## Spąstai (visi rasti skaudžiai)

- UI tekstai lietuviski BE diakritikos ("Truksta tasku", ne "Trūksta taškų").
- Stalo lange `profileBadge` sumazintas per `transform: scale` — layout dezute
  didesne uz vizuala; kompensuojama neigiamais margin. Svytejimui naudok
  `filter: drop-shadow` (seka vizuala, apeina box-shadow !important temas).
- HTML5 drag NEVEIKIA is `<button>` vidaus — atversta kortele yra overlay
  sibling (`deckRevealOverlay`), ne mygtuko vaikas.
- `deckRevealAnim` animacija naudoja transform — pozicionuok TEVA be transform.
- Fono scroll uzrakinamas `body:has(.tableWindowOverlay) { overflow: hidden }`;
  stalo langas naudoja `100dvh`.
- Zaidejo vieta (`.tableSeat.me`) rista prie stalo APACIOS
  (`translate(-50%,-100%)`, y=99%) — necentruok atgal, nukirps mazuose ekranuose.
- Oponentu "Kortos: x" perkeltas virs korteles per grid `order: -1` +
  seat'ai pastumti +36px zemyn (kitaip kerpa `overflow: hidden`).
- NeDB failas — append-only zurnalas: galioja PASKUTINE iraso versija,
  dublikatai normalu. Neredaguok rankomis kol serveris veikia.
- E2E testai uztersia lokalu `server/data/auth-users.db` — pries commit:
  `git checkout -- server/data/auth-users.db`.
- Dideles PNG konvertuok i JPEG per PowerShell System.Drawing i
  `client/src/assets/` (fonams permatomumo nereikia, ~10x maziau).
- Playwright drag: griebk korta uz matomo krasto (`sourcePosition`), centras
  gali buti uzdengtas.
- pg-mem nepalaiko `CREATE TABLE IF NOT EXISTS` su inline constraints —
  testuose DDL perimamas per `interceptQueries`.

## Ekonomika

Registracija +250 pts. Kiekvienas match: +200 visiems, vietos bonusai
+200/+100/+50 (PLACEMENT_BONUS). Kainos pagal rarity: 0/100/250/1000/5000/10000.
Zeus turi price override 2000 (`AVATAR_PRICE_OVERRIDES`).

## Deploy

Push i `main` -> GitHub Actions (`.github/workflows/deploy.yml`) triggerina
Render + Vercel deploy hooks. Render env: `APP_SECRET`, `DATABASE_URL` (Neon),
`CLIENT_URL`, `ALLOWED_ORIGINS`, `DATA_DIR=/var/data`. Render free plane
Shell NEPRIEINAMAS — produkcijos DB pasiekiama tiesiogiai per Neon
(SQL Editor arba pg is lokalios masinos). Taskai pridedami per
`POST /admin/grant-points` (header `X-App-Secret`; dev reiksme
`dev-secret-change-me`).
