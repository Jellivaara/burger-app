# Burger App

Vibe-koodaamalla toteutettu selainpohjainen ravintolan tilaushallintasovellus, jossa on erilliset näkymät kassalle, keittiölle ja adminille.

Sovellus on rakennettu `React` + `Vite` -pinolla ja käyttää `Firebase Realtime Databasea` sekä `Firebase Storagea`.

## Ominaisuudet

 `Kassa`
- uuden tilauksen luonti
- tilausten muokkaus suoraan tilauskortin sisällä
- pöytien hallinta ja vapaat pöydät
- annoshaku nimellä tai kategorialla
- kategoriatila ja kategorioimaton näkymä

 `Keittiö`
- tilaukset vaiheittain omissa sarakkeissa
- drag and drop tilausten siirtämiseen
- muokattujen tilausten muutosten korostus
- kuittaus keittiölle näkyville muutoksille

 `Admin`
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

Kassalla luodaan ja muokataan pöytätilauksia sekä siirretään tilauksia eteenpäin keittiölle.

### Keittiö

Keittiö siirtää tilauksia (Odottaa, Työn alla ja valmis) osioiden välillä. Keittiö näkee myös selkeästi kassan tekemät muutokset tilauksiin.

### Admin

Admin hallinnoi ruokalistaa, tuotekategorioita, päivän myyntiä, avoimia pöytiä ja päivän päättämistä.

## Huomioita
- Sovellus on toteutettu vibe-koodamalla käyttäen `Codexia`
- Sovellus on suunniteltu käytettäväksi tietokoneella ja tabletilla tai älypuhelimella.
- Drag and drop -toimintoja on sekä ruokalistassa että hallintapaneeleissa.
- Päivän lopetus vaatii, että avoimet pöydät on ensin suljettu tai poistettu.

## Kehityshuomiot

- Pääosa sovelluslogiikasta on tällä hetkellä tiedostossa `src/App.jsx`.
- Ulkoasut ja näkymien yhteinen visuaalinen kieli ovat tiedostossa `src/App.css`.

