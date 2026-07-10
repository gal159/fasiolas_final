# Fasiolas MVP

Pradine web zaidimo implementacija su dviem fazemis:
- 1 faze: issidalinimas su +1 taisykle ir fasiolo skundu
- 2 faze: zaidimas su kozeriu ir piko apribojimu

## Struktura

- client: React + Vite UI
- server: Node.js + Socket.io autoritetinga zaidimo logika
- shared: bendri tipai

## Paleidimas

### 1) Serveris

```powershell
cd server
npm install
npm run dev
```

Serveris paleidziamas ant http://localhost:3001

### 2) Klientas

```powershell
cd client
npm install
npm run dev
```

Klientas paleidziamas ant Vite URL (pvz. http://localhost:5173)

## Implementuota dabar

- Kambario kurimas ir prisijungimas (2-8)
- Zaidejo reconnect pagal issaugota player id
- 1 fazes veiksmai:
  - perkelti virsutine matoma korta kitam
  - traukti is vidurio ir deti sau arba kitam
  - ejimo pabaiga
- Fasiolas (tik 1 faze):
  - skundas rankiniu budu
  - baudos korta is kiekvieno kito zaidejo ne nuo virsaus
  - kortos suklydusiam dedamos i kalades gala
- 2 fazes perjungimas kai vidurine kalade tuscia
- Kozerio nustatymas pagal paskutine istraukta ne piko korta
- Pradeda zaidejas turintis piku 9
- 2 fazes ejimai:
  - ant piko galima deti tik aukstesni pika
  - ant kozerio tik aukstesnis kozeris
  - ant paprastos kortos aukstesne to paties simbolio arba kozeris
  - galima paimti seniausia korta nuo stalo
- Kai ant stalo kortu kiekis pasiekia zaideju skaiciu, stalas isvalomas ir paskutinis padejes pradeda nauja grandine
- Pabaiga: lieka vienas su kortomis, jis pralaimi
- Shop ekonomika profilio langelyje:
  - taskai uz suzaista matcha: +20 visiems
  - papildomas Top3 bonusas: +20 / +10 / +5
  - pirkimai uz taskus (effects, skins, hats, avatars)
  - Common itemai yra nemokami
  - kainos pagal rarity: Common 0, Uncommon 100, Rare 250, Epic 1000, Legendary 5000, Mythic 10000
  - serveris validuoja ownership, tad neisigyti itemai negali buti pritaikomi profilyje

## Shop pastaba

- Dabartiniame etape account/shop progresas laikomas serverio atmintyje (in-memory), todel po server restarto taskai ir pirkimai nusinulina.

## Online hostinimas (Render + Vercel)

Sis projektas padalintas i dvi dalis:
- backend: `server` (Express + Socket.IO)
- frontend: `client` (Vite)

### 1) Backend i Render

Repo jau turi `render.yaml` su paruosu service konfiguracija.

Zingsniai:
1. Push i GitHub.
2. Render dashboard pasirink `New` -> `Blueprint` ir prijunk repo.
3. `render.yaml` jau apibrezia pastovu disko (`disk`) mount'a `/var/data` su
   `DATA_DIR=/var/data` env kintamuoju - tai reiskia, kad vartotoju paskyros
   ir shop pirkiniai (NeDB failas) islieka po kiekvieno redeploy.
4. Sukurus servisa nustatyk env kintamuosius:
  - `APP_SECRET` (privalomas, ilgas random tekstas - `render.yaml` ji palieka
    tuscia is anksto, uzpildyk Render dashboard'e)
  - `CLIENT_URL` ir `ALLOWED_ORIGINS` jau nustatyti i
    `https://lediniaisprendimai.com` (`render.yaml`) - pakeisk, jei naudosi
    kitokia domena.
5. Deploy.

Patikra:
- atsidaryk `https://your-render-service-url/health`
- turi grazinti `{ "ok": true }`
- po pirmo deploy padaryk testine registracija/pirkima, tada Render
  dashboard'e paleisk "Manual Deploy" ir patikrink, kad paskyra bei pirkinys
  islieka (patvirtina, kad pastovus diskas veikia)

### 2) Frontend i Vercel

`client` aplanke jau pridetas `vercel.json`.

Zingsniai:
1. Vercel dashboard pasirink `Add New Project` ir prijunk ta pati repo.
2. Root directory nustatyk i `client`.
3. Environment Variables prideti:
  - `VITE_SERVER_URL` = tavo Render backend URL (pvz. `https://fasiolas-server.onrender.com`)
4. Deploy.

### 2b) Savo domenas (pvz. Hostinger)

Jei turi savo domena (pvz. `lediniaisprendimai.com`) ir nori ji prijungti
prie Vercel frontend'o:

1. Vercel projekte: `Settings` -> `Domains` -> prideti
   `lediniaisprendimai.com` ir `www.lediniaisprendimai.com`.
2. Vercel parodys reikiamus DNS irasus - paprastai:
   - apex domenui (`lediniaisprendimai.com`): `A` irasas i Vercel nurodyta IP
     (arba `ALIAS`/`ANAME`, jei Hostinger DNS tai palaiko)
   - `www` subdomenui: `CNAME` -> `cname.vercel-dns.com`
3. Hostinger valdymo skydelyje (Domains -> DNS / Name Servers) prideti sius
   irasus tiksliai taip, kaip parode Vercel.
4. Palauk DNS propagacijos (nuo keliu minuciu iki keliu valandu), Vercel
   automatiskai isduos SSL sertifikata, kai domenas patvirtintas.
5. Render aplinkoje atnaujink `CLIENT_URL` ir `ALLOWED_ORIGINS` i galutini
   domena, jei jis skiriasi nuo pradinio `https://lediniaisprendimai.com`.

### 3) CORS ir reset nuorodos

Backend naudoja `CLIENT_URL` reset nuorodoms (`/auth/forgot-password`), todel po frontend domeno pakeitimo atnaujink `CLIENT_URL` Render aplinkoje.

### 4) Greitas smoke test po deploy

1. Prisiregistruoti / prisijungti.
2. Sukurti kambari ir prisijungti is antro browser lango.
3. Patikrinti, kad zaidimo state sinchronizuojasi realiu laiku.
4. Patikrinti marketplace pirkima ir profilio issaugojima.

## Railway alternatyva (backend)

Backend aplanke prideti failai:
- `server/Dockerfile`
- `server/railway.toml`

Zingsniai:
1. Railway sukurk nauja projekta is GitHub repo.
2. Root directory nustatyk i `server`.
3. Railway panaudos Docker build (`Dockerfile`) ir paleis `npm run start`.
4. Aplinkos kintamieji Railway:
  - `APP_SECRET` (privalomas)
  - `CLIENT_URL` (tavo frontend domenas)
  - `ALLOWED_ORIGINS` (frontend origin; jei keli, atskirk kableliu)
  - `PORT` (Railway duoda automatiskai)

Pastaba:
- Jei naudoji Railway backend, `client` aplinkoje `VITE_SERVER_URL` turi rodyti i Railway domena.

## Automatinis deploy po push i main (GitHub Actions)

Pridetas workflow failas:
- `.github/workflows/deploy.yml`

Ka jis daro:
1. Po `push` i `main` (arba rankiniu budu per `workflow_dispatch`) iskviecia deploy hookus.
2. Triggerina Render ir Vercel deploy, jei nustatyti GitHub secrets.

Reikalingi GitHub repository secrets:
1. `RENDER_DEPLOY_HOOK_URL`
2. `VERCEL_DEPLOY_HOOK_URL`

Kur gauti hook URL:
1. Render -> tavo service -> Settings -> Deploy Hook
2. Vercel -> Project Settings -> Deploy Hooks

## Pastaba

Tai MVP implementacija: taisykliu validacija ir UX yra pradine versija, skirta greitam testavimui su draugais ir tolesniam iteravimui.
