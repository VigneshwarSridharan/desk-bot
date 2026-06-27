import { tool } from 'ai';
import { z } from 'zod';
import axios from 'axios';
import { getAllSettings } from '../store/db.js';

async function doGetWeather() {
  const settings = getAllSettings();
  const lat = settings.weatherLat;
  const lon = settings.weatherLon;
  const city = settings.weatherCity || 'Unknown';

  if (!lat || !lon) return { error: 'Weather location not configured in settings' };

  try {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min',
        timezone: 'auto',
        forecast_days: 3,
      },
      timeout: 8000,
    });

    const c = data.current;
    const d = data.daily;

    const weatherDesc = getWeatherDescription(c.weather_code);

    return {
      city,
      current: {
        temperature: Math.round(c.temperature_2m),
        feelsLike: Math.round(c.apparent_temperature),
        humidity: c.relative_humidity_2m,
        windSpeed: Math.round(c.wind_speed_10m),
        description: weatherDesc,
        code: c.weather_code,
      },
      forecast: d.time.slice(0, 3).map((date, i) => ({
        date,
        description: getWeatherDescription(d.weather_code[i]),
        maxTemp: Math.round(d.temperature_2m_max[i]),
        minTemp: Math.round(d.temperature_2m_min[i]),
      })),
    };
  } catch (err) {
    return { error: err.message };
  }
}

function getWeatherDescription(code) {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 69) return 'Drizzle';
  if (code <= 79) return 'Rain';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

export const getWeatherTool = tool({
  description: 'Get current weather and 3-day forecast for the configured location. No parameters needed — location comes from user settings.',
  parameters: z.object({}),
  execute: async () => doGetWeather(),
});
