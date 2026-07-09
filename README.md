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

## Pastaba

Tai MVP implementacija: taisykliu validacija ir UX yra pradine versija, skirta greitam testavimui su draugais ir tolesniam iteravimui.
