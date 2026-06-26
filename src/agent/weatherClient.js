const WMO_DESCRIPTIONS = {
  0: 'Clear sky',
  1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

function wmoDescription(code) {
  return WMO_DESCRIPTIONS[code] ?? 'Unknown'
}

export async function fetchWeather(lat, lon, signal) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', lat)
  url.searchParams.set('longitude', lon)
  url.searchParams.set('current', [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
  ].join(','))
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '3')

  const res = await fetch(url.toString(), { signal })
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`)
  const data = await res.json()

  const cur = data.current
  const daily = data.daily

  return {
    current: {
      temperature: Math.round(cur.temperature_2m),
      feelsLike: Math.round(cur.apparent_temperature),
      humidity: cur.relative_humidity_2m,
      precipitation: cur.precipitation,
      windSpeed: Math.round(cur.wind_speed_10m),
      weatherCode: cur.weather_code,
      description: wmoDescription(cur.weather_code),
    },
    forecast: daily.time.map((date, i) => ({
      date,
      high: Math.round(daily.temperature_2m_max[i]),
      low: Math.round(daily.temperature_2m_min[i]),
      description: wmoDescription(daily.weather_code[i]),
      precipitation: daily.precipitation_sum[i],
    })),
    unit: data.current_units?.temperature_2m ?? '°C',
  }
}
