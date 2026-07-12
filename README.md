# Fasiolas

Realaus laiko daugelio zaidejru kortu zaidimas su dviem fazemis:
- 1 faze: issidalinimas su +1 taisykle ir fasiolo skundu
- 2 faze: zaidimas su kozeriu ir piko apribojimu

Gyva versija: https://lediniaisprendimai.com

## Struktura

- `client`: React + Vite UI (Vercel)
- `server`: Node.js + Express + Socket.IO autoritetinga zaidimo logika (Render)
- `shared`: bendri tipai ir konstantos (kosmetika, kainos, rarity)

## Paleidimas lokaliai

### 1) Serveris

```powershell
cd server
npm install
npm run dev
```

Serveris paleidziamas ant http://localhost:3001. Be `DATABASE_URL` naudojamas
NeDB failas `server/data/auth-users.db` — nieko papildomai konfiguruoti nereikia.

### 2) Klientas

```powershell
cd client
npm install
npm run dev
```

Klientas paleidziamas ant Vite URL (pvz. http://localhost:5173).

## Duomenu baze

Serveris DB pasirenka pagal `DATABASE_URL` aplinkos kintamaji:

- **Nustatytas** -> PostgreSQL (produkcijoje naudojamas Neon; lentele
  `auth_users` susikuria automatiskai paleidimo metu)
- **Nenustatytas** -> NeDB failas (lokalus dev; `DATA_DIR/auth-users.db`
  arba `server/data/auth-users.db`)

Vienkartine senu vartotoju migracija is NeDB i Postgres:

```powershell
cd server
$env:DATABASE_URL = "postgres://..."; npx tsx scripts/migrate-nedb-to-postgres.ts
```

Postgres store testai (in-memory pg-mem, DB nereikia):

```powershell
cd server
npx tsx scripts/test-postgres-store.ts
```

## Implementuota

### Paskyros
- Registracija (el. pastas + slaptazodis, scrypt hash), prisijungimas
  **el. pastu arba zaidimo vardu**
- Slaptazodzio atstatymas per reset nuoroda (`CLIENT_URL?resetToken=...`)
- 3 profilio slotai (A/B/C) su atskirom isvaizdom
- Sesijos atkurimas po puslapio perkrovimo

### Zaidimas
- Kambario kurimas ir prisijungimas (2-8), reconnect pagal issaugota player id
- 1 fazes veiksmai: perkelti virsutine matoma korta kitam, traukti is vidurio
  ir deti sau arba kitam (drag & drop arba paspaudimu), ejimo pabaiga
- Fasiolas (tik 1 faze): skundas leidziamas bet kuriam zaidejui (ne tik
  aktyviajam), baudos korta is kiekvieno kito zaidejo ne nuo virsaus
- 2 faze kai vidurine kalade tuscia: kozeris pagal paskutine ne piko korta,
  pradeda piku 9 turetojas, ant piko tik aukstesnis pikas, ant kozerio tik
  aukstesnis kozeris, galima paimti seniausia korta nuo stalo
- Pabaiga: lieka vienas su kortomis — jis pralaimi
- Aktyvaus ejimo zaidejas pazymetas auksiniu svytejimu aplink kortele
- Lobby fazeje profilio langelyje matomos visu prisijungusiu zaideju korteles

### Ekonomika ir Marketplace
- **Registracijos starteris: +250 tasku**
- Uz kiekviena matcha: **+200 visiems**, vietos bonusai **+200 / +100 / +50**
- Rezultatai (taskai, W/L, zaidimu skaicius) **israsomi i DB** zaidimo
  pabaigoje ir islieka tarp sesiju
- Marketplace sekcijos: Card backgrounds, **Stalai** (stalo fonai zaidime),
  Effects, Avatars — korteles rodo tikra prekes vaizda/efekta
- Kainos pagal rarity: Common 0, Uncommon 100, Rare 250, Epic 1000,
  Legendary 5000, Mythic 10000
- Serveris validuoja ownership — neisigyti itemai negali buti pritaikomi
- Admin endpoint taskam prideti: `POST /admin/grant-points`
  (header `X-App-Secret: <APP_SECRET>`, body `{ "email", "points" }`)

## Online hostinimas (Render + Vercel + Neon)

### 1) Backend i Render

Repo turi `render.yaml` (Blueprint) su paruosta konfiguracija.

1. Push i GitHub, Render dashboard: `New` -> `Blueprint`.
2. Env kintamieji Render dashboard'e:
   - `APP_SECRET` — privalomas ilgas random tekstas
   - `DATABASE_URL` — Neon/Postgres connection string (rekomenduojama;
     be jo naudojamas NeDB failas pastoviame diske `/var/data`)
   - `CLIENT_URL` ir `ALLOWED_ORIGINS` — jau nustatyti i
     `https://lediniaisprendimai.com`, keisk jei kita domena
3. Patikra: `https://<service>.onrender.com/health` -> `{ "ok": true }`

Pastaba: Render free plane Shell neprieinamas — produkcijos duomenis
patogiausia perziureti tiesiai Neon dashboard'e (Tables / SQL Editor).

### 2) Frontend i Vercel

`client` aplanke yra `vercel.json`.

1. Vercel: `Add New Project`, Root directory = `client`.
2. Env: `VITE_SERVER_URL` = Render backend URL
   (pvz. `https://fasiolas-server.onrender.com`).

### 3) Savo domenas

1. Vercel projekte: `Settings` -> `Domains` -> pridek `lediniaisprendimai.com`
   ir `www.lediniaisprendimai.com`.
2. Hostinger DNS: `A` irasas apex domenui i Vercel IP, `CNAME` `www` ->
   `cname.vercel-dns.com`.
3. Po domeno pakeitimo atnaujink `CLIENT_URL` ir `ALLOWED_ORIGINS` Render'yje
   (backend naudoja `CLIENT_URL` reset nuorodoms).

### 4) Automatinis deploy

`.github/workflows/deploy.yml` po push i `main` iskviecia deploy hookus.
Reikalingi GitHub secrets: `RENDER_DEPLOY_HOOK_URL`, `VERCEL_DEPLOY_HOOK_URL`
(Render: Settings -> Deploy Hook; Vercel: Project Settings -> Deploy Hooks).

### 5) Smoke test po deploy

1. Registracija (turi gauti 250 starterio tasku) / prisijungimas vardu.
2. Kambarys + antras browser langas, state sinchronizacija realiu laiku.
3. Marketplace pirkimas ir profilio issaugojimas.
4. Suzaisti matcha iki galo — taskai ir W/L turi islikti po perkrovimo.

## Railway alternatyva (backend)

`server/Dockerfile` ir `server/railway.toml` paruosti. Railway: root
directory `server`, env `APP_SECRET`, `CLIENT_URL`, `ALLOWED_ORIGINS`,
(`DATABASE_URL` jei Postgres), `PORT` duodamas automatiskai. Klientui tada
`VITE_SERVER_URL` rodo i Railway domena.
