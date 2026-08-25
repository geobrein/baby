# Babyprijs

Prijsvergelijker voor babyproducten: **luiers** (per maat en merk), **luierbroekjes**,
**billendoekjes** en **verzorging** zoals Bepanthen, Sudocrem en Zwitsal.

- Prijzen worden **elke dag automatisch opgehaald** bij de webwinkels (GitHub Action).
- De site vergelijkt op **stukprijs** — prijs per luier, per doekje of per 100 ml/100 g —
  want verpakkingen verschillen per winkel en dat maakt totaalprijzen onvergelijkbaar.
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

## Aan de slag

Node 20 of nieuwer, verder niets nodig.

```bash
npm test                     # 38 tests (parsers, matching, robots.txt, hele ronde)
npm run fetch:mock           # demoprijzen, zonder netwerkverkeer
npm run serve                # site op http://localhost:8080
```

Echte prijzen ophalen:

```bash
npm run fetch                          # alle ingeschakelde winkels
node scripts/fetch-prices.mjs --only=kruidvat,etos
node scripts/fetch-prices.mjs --product=bepanthen-baby-zalf-30g
node scripts/fetch-prices.mjs --limit=5      # eerst even klein proberen
npm run check-catalog                  # welk product wordt in welke winkel gevonden?
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
verkeer actief. Zet ze alleen aan als je daar afspraken over hebt gemaakt.

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

## Beperkingen om te weten

- De startcatalogus is **niet tegen de echte winkels getest** (dit project is zonder toegang tot
  die sites gebouwd). Draai `npm run check-catalog` en stel per product de `query`/`match` bij;
  wat niet gevonden wordt, verschijnt gewoon niet op de site.
- `site/data/prices.json` bevat nu **demoprijzen**; de eerste echte ronde overschrijft ze en de
  demo-melding op de site verdwijnt vanzelf.
- Prijzen zijn een momentopname van één keer per dag. De prijs in de winkel is leidend.
- Er wordt geen rekening gehouden met verzendkosten, kortingsacties bij meerdere stuks of
  winkelpassen.
