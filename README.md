# Burger App

Selainpohjainen ravintolan tilaushallintasovellus, jossa on erilliset näkymät kassalle, keittiölle ja adminille.

Sovellus on rakennettu `React` + `Vite` -pinolla ja käyttää `Firebase Realtime Databasea` sekä `Firebase Storagea`.

## Ominaisuudet

- `Kassa`
- uuden tilauksen luonti
- tilausten muokkaus suoraan tilauskortin sisällä
- pöytien hallinta ja vapaat pöydät
- annoshaku nimellä tai kategorialla
- kategoriatila ja kategorioimaton näkymä

- `Keittiö`
- tilaukset vaiheittain omissa sarakkeissa
- drag and drop tilausten siirtämiseen
- muokattujen tilausten muutosten korostus
- kuittaus keittiölle näkyville muutoksille

- `Admin`
- ruokalistan hallinta
- kategorioiden lisäys, muokkaus, poisto ja järjestely
- annosten lisäys, inline-muokkaus, poisto ja siirto kategorioiden välillä
- päivän myynti
- avoimet pöydät
- myydyt annokset
- menneet tapahtumat

## Teknologiat

- `React 19`
- `Vite`
- `Firebase`
- `@hello-pangea/dnd`
- `ESLint`

## Asennus

Asenna riippuvuudet:

```bash
npm install
```

Käynnistä kehityspalvelin:

```bash
npm run dev
```

Rakenna tuotantoversio:

```bash
npm run build
```

Esikatsele buildia paikallisesti:

```bash
npm run preview
```

Tarkista lint:

```bash
npm run lint
```

## Projektirakenne

```text
burger-app/
├── public/
├── src/
│   ├── App.jsx
│   ├── App.css
│   └── index.css
├── index.html
├── package.json
└── vite.config.js
```

## Firebase

Sovellus käyttää Firebasea seuraaviin tarkoituksiin:

- `Realtime Database`: tilaukset, menneet tilaukset, poistetut tilaukset ja kategoriadata
- `Storage`: annoskuvat

Nykyisessä versiossa Firebase-konfiguraatio on sovelluskoodissa tiedostossa `src/App.jsx`.

## Käyttöroolit

### Kassa

Kassalla luodaan ja muokataan pöytätilauksia sekä siirretään tilauksia eteenpäin keittiöprosessissa.

### Keittiö

Keittiö seuraa tilauksia valmistusvaiheittain ja näkee selkeästi, mitä tilaukseen on lisätty, poistettu tai muutettu.

### Admin

Admin hallinnoi ruokalistaa, kategorioita, päivän myyntiä, avoimia pöytiä ja päivän päättämistä.

## Huomioita

- Sovellus on suunniteltu kosketus- ja hiirikäyttöön.
- Drag and drop -toimintoja on sekä ruokalistassa että hallintapaneeleissa.
- Päivän lopetus vaatii, että avoimet pöydät on ensin suljettu tai poistettu.

## Kehityshuomiot

- Pääosa sovelluslogiikasta on tällä hetkellä tiedostossa `src/App.jsx`.
- Ulkoasut ja näkymien yhteinen visuaalinen kieli ovat tiedostossa `src/App.css`.

## Julkaisu GitHubiin

Kun viet projektin GitHubiin, tämä `README.md` näkyy automaattisesti repositorion etusivulla dokumentaationa.

Suositeltavaa ennen julkaisua:

- tarkista `.gitignore`
- varmista ettei salaisuuksia ole kovakoodattu tuotantoon
- aja `npm run lint`
- aja `npm run build`
