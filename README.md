# Babyprijs

Prijsvergelijker voor babyproducten: **luiers** (per maat en merk), **luierbroekjes**,
**billendoekjes** en **verzorging** zoals Bepanthen, Sudocrem en Zwitsal.

- Prijzen worden **elke dag automatisch opgehaald** bij de webwinkels (GitHub Action).
- De site vergelijkt op **stukprijs** — prijs per luier, per doekje of per 100 ml/100 g —
  want verpakkingen verschillen per winkel en dat maakt totaalprijzen onvergelijkbaar.
- **Controle op artikelnummer (EAN/GTIN)**: per winkel wordt het artikelnummer van de
  productpagina gelezen en tussen winkels vergeleken, zodat je zeker weet dat je appels met
  appels vergelijkt.
- **Luiervergelijker**: alle merken naast elkaar in één maat, op prijs per luier en per maand —
  huismerk versus Pampers, ook als de pakken verschillende aantallen bevatten.
- Elke prijs is een **directe link naar de webwinkel**.
- Statische site: geen server, geen database, geen dependencies. Hosting kan gratis op GitHub Pages.

## Hoe het werkt

```
data/catalog.json     welke producten je wilt volgen (naam, merk, maat, zoekterm, match-regels)
data/shops.json       welke winkels doorzocht worden (zoek-URL, patroon van productlinks)
        |
        v
scripts/fetch-prices.mjs   zoekt per winkel het product, leest de prijs van de productpagina
        |
        +--> data/resolved.json   cache: gevonden product-URL per product/winkel
        +--> data/identity.json   artikelnummer (EAN/SKU) per product/winkel, met wijzigingen
        +--> data/history.json    prijs per dag (90 dagen), voor "laagste prijs in 30 dagen"
        +--> data/report.json     wat er mis ging tijdens de laatste ronde
        +--> site/data/prices.json   het bestand dat de website inleest
        |
        v
site/index.html + app.js   filtert, sorteert en linkt door naar de winkel
```

Het ophalen gebeurt in twee stappen. De eerste keer wordt het product **gezocht** in de winkel;
alleen zoekresultaten die door de match-regels komen (juist merk, juiste maat, juiste variant,
juiste verpakkingsgrootte) worden geaccepteerd, en de productpagina wordt daarna nog een keer
gecontroleerd op de echte titel. De gevonden URL komt in `data/resolved.json`, zodat de dagelijkse
ronde daarna direct de productpagina ophaalt. Klopt die pagina niet meer (product vervangen,
404, geen prijs), dan wordt automatisch opnieuw gezocht.

Prijzen worden gelezen uit `schema.org`-productdata (JSON-LD) op de productpagina, met
Open Graph- en microdata-tags als terugval. Dat is waar vrijwel elke webwinkel zijn prijs
zelf publiceert voor Google Shopping.

**Een prijs die niet gevonden of niet betrouwbaar herkend wordt, komt niet op de site.**
Liever een winkel minder dan een verkeerde prijs.

## Verificatie op artikelnummer

Naam en maat zeggen niet genoeg: "Pampers Baby-Dry maat 4" bestaat in een pak van 82, een doos
van 160 en een maandbox van 174. Daarom leest de ophaler ook het **EAN/GTIN-artikelnummer** en de
**SKU** van de productpagina (uit `schema.org`, Open Graph of de specificatietabel), controleert
het controlecijfer, en vergelijkt de nummers tussen winkels. Elke prijs krijgt een niveau:

| Niveau | Betekenis | Op de site |
| --- | --- | --- |
| `exact` | artikelnummer komt overeen met de referentie | ✓ zelfde artikel |
| `variant` | geldig nummer, maar aantoonbaar een ander artikel (meestal een andere doosgrootte) | andere verpakking |
| `afwijkend` | nummer staat niet in de lijst die de catalogus voorschrijft | ander artikel |
| `onbekend` | geen nummer gevonden, of geen tweede winkel om mee te vergelijken | EAN onbekend |

De referentie komt uit `gtins` in de catalogus als je die invult, en anders uit **consensus**:
het nummer waar minstens twee winkels het over eens zijn. Met de knop *Alleen bevestigd hetzelfde
artikel* filter je de site op `exact`.

Vul je `gtins` in, dan wordt er **streng** gecontroleerd: een winkel die een ander artikel op die
pagina zet, valt af en er wordt automatisch opnieuw gezocht naar het juiste artikel. Zet
`"strictGtin": false` om alleen te labelen zonder iets weg te gooien.

Vastleggen gaat automatisch na een echte ronde:

```bash
npm run fetch                       # vult data/identity.json
node scripts/pin-gtins.mjs          # laat zien wat er vastgelegd zou worden
node scripts/pin-gtins.mjs --write  # schrijft de EANs in data/catalog.json
```

Verandert een winkel later stilletjes het artikel achter dezelfde URL, dan ziet de volgende ronde
dat het EAN gewijzigd is, meldt dat in het rapport en in de samenvatting van de Action, en zet
een waarschuwingsteken bij die prijs.

## Luiervergelijker

Naast de productweergave zit er een tweede weergave in die werkt zoals je van een
luierprijsvergelijker verwacht: kies een **maat**, en alle merken komen onder elkaar te staan
op **prijs per luier** — inclusief het bedrag **per maand** (gerekend met 150 luiers), een blok
*goedkoopste per merk*, en dezelfde filters op voorraad en artikelnummer. Zo zie je in één
oogopslag of het huismerk van 50 stuks echt goedkoper is dan een maandbox Pampers.

De weergave is deelbaar via de URL, bijvoorbeeld `?view=luiers&maat=4&merk=Pampers,Kruidvat`.

## Aan de slag

Node 20 of nieuwer, verder niets nodig.

```bash
npm test                     # 63 tests (parsers, EAN-controle, matching, robots.txt, hele ronde)
npm run fetch:mock           # demoprijzen, zonder netwerkverkeer
npm run serve                # site op http://localhost:8080
```

Echte prijzen ophalen:

```bash
npm run fetch                          # alle ingeschakelde winkels
node scripts/fetch-prices.mjs --only=kruidvat,etos
node scripts/fetch-prices.mjs --product=bepanthen-baby-zalf-30g
node scripts/fetch-prices.mjs --limit=5      # eerst even klein proberen
node scripts/fetch-prices.mjs --budget=10    # stop na 10 minuten en bewaar wat er is
npm run check-catalog                  # welk product wordt in welke winkel gevonden (met EAN)?
node scripts/pin-gtins.mjs --write     # gevonden artikelnummers vastleggen in de catalogus
node scripts/validate-catalog.mjs      # catalogus controleren zonder netwerk
```

## Een product toevoegen

Zet er een blok bij in `data/catalog.json`:

```json
{
  "id": "pampers-baby-dry-4",
  "name": "Pampers Baby-Dry maat 4",
  "brand": "Pampers",
  "category": "luiers",
  "size": "4",
  "weight": "9-14 kg",
  "unit": "stuk",
  "query": "Pampers Baby-Dry maat 4 luiers",
  "match": { "must": ["pampers", "dry"], "none": ["pants", "broekjes"] }
}
```

| Veld | Betekenis |
| --- | --- |
| `query` | Wat er in de zoekbalk van de winkel getypt wordt. Per winkel te overschrijven via `queries: { "bol": "..." }`. |
| `match.must` | Woorden die in de producttitel moeten staan. |
| `match.none` | Woorden die de titel juist uitsluiten (zo houd je luiers en luierbroekjes uit elkaar). |
| `match.packSize` | Verplichte verpakkingsgrootte, bijvoorbeeld `30` voor de tube van 30 gram. |
| `size` | Luiermaat. De titel moet dan "maat 4" (of `size 4`) bevatten. |
| `gtins` | Lijst met toegestane EAN-nummers. Ingevuld = strenge controle op artikelnummer. |
| `strictGtin` | `false` zet die strenge controle uit; afwijkende artikelen worden dan alleen gemarkeerd. |
| `unit` | `stuk`, `ml` of `g` — bepaalt hoe de stukprijs getoond wordt. |
| `shops` | Optioneel: alleen deze winkels doorzoeken (bijvoorbeeld huismerken). |
| `links` | Optioneel: een vaste product-URL per winkel, dan wordt er niet gezocht. |

Controleer daarna met `node scripts/check-catalog.mjs --product=<id>` of het product in elke
winkel gevonden wordt, en pas zo nodig `query` of `match` aan.

## Een winkel toevoegen

In `data/shops.json`:

```json
"babypark": {
  "name": "Babypark",
  "site": "https://www.babypark.nl",
  "enabled": true,
  "delayMs": 3000,
  "searchUrl": "https://www.babypark.nl/catalogsearch/result/?q={q}",
  "productPathPattern": "\\.html$"
}
```

`productPathPattern` is een reguliere expressie op het **pad** van een link; daarmee worden
productlinks uit de zoekresultatenpagina gevist. `delayMs` is de wachttijd tussen twee
verzoeken aan dezelfde winkel.

Albert Heijn en Jumbo staan meegeleverd maar **uitgeschakeld**: die sites weren geautomatiseerd
verkeer actief. Zet ze alleen aan als je daar afspraken over hebt gemaakt. Zie ook
*Wat de eerste echte ronde uitwees* hieronder: op dit moment is geen van de winkels via de
zoekpagina bereikbaar.

## Dagelijks bijwerken en publiceren

Drie workflows in `.github/workflows/`:

| Workflow | Wanneer | Wat |
| --- | --- | --- |
| `update-prices.yml` | elke dag 05:15 UTC + handmatig | haalt de prijzen op en commit `site/data/prices.json`, de cache en de historie |
| `pages.yml` | na een geslaagde prijsronde + bij wijzigingen in `site/` | publiceert `site/` op GitHub Pages |
| `ci.yml` | elke push en pull request | tests, demoronde en catalogusvalidatie |

Eenmalig instellen: **Settings → Pages → Source: GitHub Actions**, en onder
**Settings → Actions → General → Workflow permissions** de optie *Read and write permissions*
aanzetten zodat de prijsronde kan committen.

De cron staat op 05:15 UTC (07:15 Nederlandse zomertijd). Aanpassen kan in `update-prices.yml`;
GitHub voert cronjobs in UTC uit en kan ze bij drukte enkele minuten later starten.

## Netjes scrapen

De ophaler is met opzet voorzichtig:

- **robots.txt wordt gerespecteerd**, inclusief `Crawl-delay`; verboden paden worden overgeslagen.
- **Eén verzoek per winkel tegelijk**, met standaard 3-5 seconden ertussen.
- **Herkenbare user-agent** met een link naar deze repository.
- **Retries met backoff** bij 429 en 5xx, en `Retry-After` wordt gevolgd.
- Alleen de zoekpagina en de productpagina worden opgehaald — er wordt niets doorgekropen.

Blijf zelf verantwoordelijk voor de voorwaarden van de winkels die je toevoegt. Heeft een winkel
een affiliate- of product-API (bol heeft die bijvoorbeeld), gebruik die dan in plaats van HTML;
dat is stabieler en netter. De site toont geen winkelfoto's of -teksten, alleen prijs,
verpakkingsgrootte en een link.

## Wat de eerste echte ronde uitwees (26 augustus 2026)

Zoeken via de zoekpagina van de winkel werkt niet vanaf GitHub Actions. Gemeten met
`node scripts/probe-shops.mjs` (workflow *Winkels onderzoeken*):

| Winkel | robots.txt | Zoekpagina | Productpagina | Bereikbaar |
| --- | --- | --- | --- | --- |
| Babypark | leesbaar | verboden | toegestaan | ja (HTTP 200) |
| bol | leesbaar | verboden | toegestaan | homepage timeout |
| Kruidvat | HTTP 403 | - | - | nee |
| Trekpleister | HTTP 403 | - | - | nee |
| Etos | timeout | - | - | nee |
| Albert Heijn | HTTP 403 | - | - | nee |
| Jumbo | timeout | - | - | nee |

Kort samengevat: Kruidvat, Trekpleister, Albert Heijn weren het verkeer met een 403,
Etos en Jumbo antwoorden niet, en bol en Babypark verbieden de zoekpagina in hun
robots.txt (daar houdt de ophaler zich aan) maar staan productpagina's wel toe.

Daarmee zijn er nog twee begaanbare wegen:

1. **Officiele feeds of API's.** Zo werken echte prijsvergelijkers: via het
   partnerprogramma van bol of een affiliatenetwerk (Awin, Daisycon, TradeTracker) krijg
   je een productfeed met prijs, voorraad, EAN en een deeplink. Stabiel, toegestaan, en
   de EAN-verificatie in dit project wordt er alleen maar sterker van.
2. **Vaste product-URL's** via `links` in de catalogus, voor winkels die productpagina's
   toestaan. Dan wordt er niet gezocht en blijft het bij het ophalen van die ene pagina.

## Beperkingen om te weten

- De startcatalogus is **niet tegen de echte winkels getest** (dit project is zonder toegang tot
  die sites gebouwd). Draai `npm run check-catalog` en stel per product de `query`/`match` bij;
  wat niet gevonden wordt, verschijnt gewoon niet op de site.
- `site/data/prices.json` bevat nu **demoprijzen**; de eerste echte ronde overschrijft ze en de
  demo-melding op de site verdwijnt vanzelf.
- Prijzen zijn een momentopname van één keer per dag. De prijs in de winkel is leidend.
- Grote winkels weren geautomatiseerd verkeer soms actief. Daarom stopt de ophaler bij een winkel
  na zes mislukkingen op rij, en stopt de hele ronde na het tijdbudget (`--budget`, standaard 25
  minuten) — wat dan gevonden is, wordt gewoon bewaard en gepubliceerd.
- Niet elke winkel publiceert een EAN. Zonder artikelnummer blijft de vergelijking op naam,
  maat en verpakkingsgrootte staan — dat is dan zichtbaar als *EAN onbekend*.
- Er wordt geen rekening gehouden met verzendkosten, kortingsacties bij meerdere stuks of
  winkelpassen.
