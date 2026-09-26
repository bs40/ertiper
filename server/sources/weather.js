// Current conditions from Open-Meteo (free, no key).
import { getJson, TtlCache } from '../lib/http.js';

const cache = new TtlCache(10 * 60_000);

// WMO weather codes -> [description, icon]
function describe(code) {
  if (code === 0) return ['Clear', 'clear'];
  if (code === 1) return ['Mainly clear', 'clear'];
  if (code === 2) return ['Partly cloudy', 'partly'];
  if (code === 3) return ['Overcast', 'cloudy'];
  if (code === 45 || code === 48) return ['Fog', 'fog'];
  if (code >= 51 && code <= 57) return ['Drizzle', 'drizzle'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return [code >= 80 ? 'Showers' : 'Rain', 'rain'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['Snow', 'snow'];
  if (code >= 95) return ['Thunderstorm', 'thunder'];
  return ['—', 'cloudy'];
}

export function getWeather(lat, lon) {
  return cache.wrap(`${lat},${lon}`, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day`;
    const data = await getJson(url, { timeoutMs: 8000 });
    const c = data?.current;
    if (!c) return null;
    const [text, icon] = describe(c.weather_code);
    return { tempC: Math.round(c.temperature_2m), text, icon, isDay: c.is_day === 1 };
  });
}
