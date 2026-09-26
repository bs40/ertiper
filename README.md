# Bristol Flight Board

A split-flap departure board that shows the aircraft you can see from your window near Bristol Airport:
flight number, where it's going or coming from, airline, aircraft type, registration, a photo of the
actual aircraft, and a live map with the route and progress.

## Run it

Needs Node.js 20 or newer.

```bash
npm start
```

Then open <http://localhost:8080>. Press F11 in the browser for full screen.

- `http://localhost:8080/?demo`: a simulated departure, for checking the look at any hour
- `http://localhost:8080/?still`: turns off the flip animation

## Settings

Open <http://localhost:8080/settings>, or move the mouse over the board and click the gear in the
bottom-right corner.

- **Airport:** search any airport with scheduled flights by name, city or code.
- **Which flights to show:**
  - **Planes I can see:** aircraft inside your view wedge. Needs your location.
  - **All arrivals / All departures / All flights:** whatever is landing or taking off right now,
    otherwise the next scheduled flight.
- **Your location & view (optional):**
  - Click the map, or type `lat, lon` or a plus code such as `C65F+GG`.
  - Drag the round handles to turn and widen the view.
  - Use the sliders for distance and maximum height.

The board reloads itself within a few seconds of saving.

The flight map on the board can be zoomed (wheel, pinch or +/−) and dragged. It stays where you leave
it until you press the reset button under the zoom buttons.

The airport list is `data/airports.json`, built from OurAirports (public domain). To refresh it,
download <https://davidmegginson.github.io/ourairports-data/airports.csv> and run
`node scripts/build-airports.mjs airports.csv`.

## How it decides what you can see

The settings page writes these to `config.json` → `home` and `view`:

| Setting | Meaning |
|---|---|
| `home.lat`, `home.lon` | Your window. Right-click your house in Google Maps to copy the exact coordinates. |
| `view.bearing` | Direction your window faces (0 = north, 90 = east, 180 = south, 270 = west). |
| `view.width` | How wide your view is, in degrees. 120 means 60° either side of `bearing`. |
| `view.rangeKm` | How far away a plane can be and still count. |
| `view.maxAltFt` | Ignore planes higher than this (cruising overflights). |
| `focusLingerSeconds` | How long to keep following a plane after it leaves your view. |

When a plane is in view, the board shows it live. When the sky is empty, it shows the next scheduled
departure or arrival.

## Data sources

| What | Source | Cost |
|---|---|---|
| Live positions | adsb.lol (backup: adsb.fi) | Free, non-commercial |
| Route, aircraft type, registration | adsb.im route set, adsbdb | Free |
| Timetable, times, status | AeroDataBox via RapidAPI | Free test tier; Pro is $8/month |
| Aircraft photo | airport-data.com (falls back to Planespotters.net) | Free, with credit |
| Weather | Open-Meteo | Free |
| Map | Esri World Imagery | Free, non-commercial |
| Airline logos | pics.avs.io | Free |

### Adding real timetable data (AeroDataBox)

Until a key is added, Bristol uses a **sample timetable** (marked on screen). Other airports show live
planes only.

1. Create an account at <https://rapidapi.com> and subscribe to **AeroDataBox**. The Basic (free) plan
   is fine for testing, and Pro ($8/month, 5,000 units) covers everyday use.
2. Copy your `X-RapidAPI-Key` into `config.json` → `aerodatabox.rapidApiKey`, or set the
   `AERODATABOX_KEY` environment variable instead.
3. Restart with `npm start`.

The board fetches Bristol's departures and arrivals every 30 minutes between 05:00 and 23:00. That is
about 2,200 units a month if each call costs 2 units.

### Aircraft photos

The board uses full-size photos from airport-data.com where they exist. Otherwise it falls back to
Planespotters.net, which covers far more aircraft but only offers smaller (about 500px) images through
its API. Planespotters asks apps to include a contact address, set in
`config.json` → `planespotters.contact`.

## Installing on another PC (Windows service + IIS)

`installer\dist\ErtiperSetup-<version>.exe` installs everything on a 64-bit Windows 10/11 PC. Run it as
an administrator. It:

1. **Turns on IIS** (static pages only) and installs Microsoft's **URL Rewrite** and **ARR** add-ons if
   missing, then enables the IIS proxy.
2. **Copies the app** to `C:\Program Files\Ertiper`, including its own Node.js, so Node doesn't need
   installing separately.
3. **Registers the "Ertiper Flight Board" Windows service.** It starts automatically (delayed start),
   restarts on failure, runs as the low-privilege LocalService account, and listens only on
   `127.0.0.1:8095`. Setup stops without changing anything if another program already uses that port.
4. **Uses the IIS site named `ertiper`.** It copies the pages and `web.config` into that site's folder
   and leaves the site's app pool alone. If the site doesn't exist, it creates one on port 8081 in
   `C:\inetpub\ertiper`. IIS serves the pages and forwards `/api/*` to the service.
5. **Opens the site's port(s)** in Windows Firewall for private (home) networks.

Then browse to **http://<pc-name>:8081/**. Start-menu shortcuts are added for the board and its
settings.

| What | Where |
|---|---|
| Settings (incl. AeroDataBox key) | `C:\ProgramData\Ertiper\config.json`, kept on upgrade and uninstall |
| Service logs | `C:\ProgramData\Ertiper\logs` |
| Setup log | `%TEMP%\Setup Log <date>.txt` |
| Diagnostics | Start menu → **Ertiper Diagnostics** (run as administrator); saves a report to the Desktop |

- **After editing `config.json` by hand,** restart the service: `Restart-Service Ertiper`.
- **To upgrade,** run a newer setup EXE over the top.
- **Uninstalling** removes the service and the firewall rule. It leaves the `ertiper` IIS site and its
  files, IIS, the add-ons and your settings in place.
- **Setup overwrites `web.config` in the site's folder,** because it contains the rule that forwards
  `/api` to the service.

### Building the installer

```powershell
installer\build.ps1
```

This needs Inno Setup 6 (`winget install JRSoftware.InnoSetup`). The first run downloads the bundled
parts into `installer\vendor` and checks them:

- Node.js 24 LTS, checked against its official SHA-256 list
- WinSW 2.12
- URL Rewrite and ARR, checked for Microsoft's signature

The version number comes from `package.json`.

## Adding your own receiver later

A Raspberry Pi with an RTL-SDR dongle running `readsb` or `tar1090` serves the same JSON format as
adsb.lol. A local feed can be added as the first entry in `FEEDS` in `server/sources/adsb.js`.
