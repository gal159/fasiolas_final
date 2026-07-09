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

## Pastaba

Tai MVP implementacija: taisykliu validacija ir UX yra pradine versija, skirta greitam testavimui su draugais ir tolesniam iteravimui.
