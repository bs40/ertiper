// Friendly names for common ICAO aircraft type designators.
const AIRCRAFT_TYPES = {
  A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330-900',
  A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380',
  BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300',
  B733: 'Boeing 737-300', B734: 'Boeing 737-400', B737: 'Boeing 737-700', B738: 'Boeing 737-800',
  B739: 'Boeing 737-900', B37M: 'Boeing 737 MAX 7', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9',
  B752: 'Boeing 757-200', B763: 'Boeing 767-300', B772: 'Boeing 777-200', B77W: 'Boeing 777-300ER',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  AT72: 'ATR 72', AT75: 'ATR 72-500', AT76: 'ATR 72-600', AT43: 'ATR 42', AT45: 'ATR 42-500', AT46: 'ATR 42-600',
  DH8A: 'Dash 8-100', DH8C: 'Dash 8-300', DH8D: 'Dash 8 Q400',
  E145: 'Embraer ERJ-145', E170: 'Embraer 170', E75L: 'Embraer 175', E75S: 'Embraer 175',
  E190: 'Embraer 190', E195: 'Embraer 195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2',
  CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900', CRJX: 'Bombardier CRJ1000',
  SF34: 'Saab 340', SB20: 'Saab 2000', J328: 'Dornier 328JET', D328: 'Dornier 328',
  C172: 'Cessna 172', C152: 'Cessna 152', PA28: 'Piper PA-28', DA42: 'Diamond DA42',
  EC35: 'Airbus H135', EC45: 'Airbus H145', EC30: 'Airbus H130', A139: 'Leonardo AW139', A169: 'Leonardo AW169',
  C56X: 'Cessna Citation Excel', C68A: 'Cessna Citation Latitude', CL35: 'Challenger 350', GLF6: 'Gulfstream G650',
  PC12: 'Pilatus PC-12', BE20: 'Beech King Air 200', BE9L: 'Beech King Air 90',
};

export function aircraftName(icaoType, manufacturer, model) {
  if (icaoType && AIRCRAFT_TYPES[icaoType]) return AIRCRAFT_TYPES[icaoType];
  if (manufacturer && model) {
    const maker = manufacturer.split(/\s+/)[0];
    return `${maker[0]}${maker.slice(1).toLowerCase()} ${model}`.trim();
  }
  return model || icaoType || null;
}

// Short board names where the city name is too long or misleading.
const BOARD_NAMES = {
  PMI: 'PALMA', TFS: 'TENERIFE S', TFN: 'TENERIFE N', LPA: 'GRAN CANARIA', ACE: 'LANZAROTE',
  FUE: 'FUERTEVENTURA', FNC: 'MADEIRA', MAH: 'MENORCA', IBZ: 'IBIZA', CFU: 'CORFU', HER: 'HERAKLION',
  RHO: 'RHODES', ZTH: 'ZAKYNTHOS', KGS: 'KOS', CHQ: 'CHANIA', EFL: 'KEFALONIA', PVK: 'PREVEZA',
  DLM: 'DALAMAN', AYT: 'ANTALYA', BJV: 'BODRUM', LCA: 'LARNACA', PFO: 'PAPHOS', MLA: 'MALTA',
  RAK: 'MARRAKECH', AGA: 'AGADIR', BFS: 'BELFAST', BHD: 'BELFAST CITY', CDG: 'PARIS CDG', ORY: 'PARIS ORLY',
  BVA: 'PARIS BVA', BER: 'BERLIN', MXP: 'MILAN MXP', LIN: 'MILAN LIN', BGY: 'BERGAMO', FCO: 'ROME FCO',
  CIA: 'ROME CIA', NAP: 'NAPLES', VCE: 'VENICE', GVA: 'GENEVA', ZRH: 'ZURICH', INN: 'INNSBRUCK',
  SZG: 'SALZBURG', KRK: 'KRAKOW', GDN: 'GDANSK', WRO: 'WROCLAW', WAW: 'WARSAW', KTW: 'KATOWICE',
  LIS: 'LISBON', OPO: 'PORTO', FAO: 'FARO', AGP: 'MALAGA', ALC: 'ALICANTE', BCN: 'BARCELONA',
  SVQ: 'SEVILLE', VLC: 'VALENCIA', BIO: 'BILBAO', MAD: 'MADRID', REU: 'REUS', GRO: 'GIRONA',
  NCE: 'NICE', LYS: 'LYON', BOD: 'BORDEAUX', TLS: 'TOULOUSE', MRS: 'MARSEILLE', GNB: 'GRENOBLE',
  CMF: 'CHAMBERY', JER: 'JERSEY', GCI: 'GUERNSEY', IOM: 'ISLE OF MAN', DUB: 'DUBLIN', ORK: 'CORK',
  NOC: 'KNOCK', SNN: 'SHANNON', EDI: 'EDINBURGH', GLA: 'GLASGOW', ABZ: 'ABERDEEN', INV: 'INVERNESS',
  NCL: 'NEWCASTLE', NQY: 'NEWQUAY', AMS: 'AMSTERDAM', CPH: 'COPENHAGEN', PRG: 'PRAGUE', BUD: 'BUDAPEST',
  VIE: 'VIENNA', DBV: 'DUBROVNIK', SPU: 'SPLIT', SOF: 'SOFIA', BOJ: 'BOURGAS', OTP: 'BUCHAREST',
  RIX: 'RIGA', VNO: 'VILNIUS', TIA: 'TIRANA', EWR: 'NEWARK', JFK: 'NEW YORK JFK', MCO: 'ORLANDO',
  BGI: 'BARBADOS', CUN: 'CANCUN', HRG: 'HURGHADA', SSH: 'SHARM EL SHEIKH', BRS: 'BRISTOL',
};

/** Uppercase A-Z/0-9 text suitable for the split-flap characters. */
export function flapText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 \-.'/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function boardName(airport, maxLen = 13) {
  if (!airport) return '';
  if (airport.iata && BOARD_NAMES[airport.iata]) return BOARD_NAMES[airport.iata];
  let name = flapText(airport.city || airport.name || airport.iata || '');
  if (name.length <= maxLen) return name;
  // Trim at a word boundary, dropping filler words left dangling at the end.
  const words = name.split(' ');
  let out = '';
  for (const w of words) {
    if ((out ? out.length + 1 : 0) + w.length > maxLen) break;
    out = out ? `${out} ${w}` : w;
  }
  out = out.replace(/\s+(DE|DEL|LA|LE|DI|DA|DO|OF|THE)$/, '');
  return out || name.slice(0, maxLen);
}
