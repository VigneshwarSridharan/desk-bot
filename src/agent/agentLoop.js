import { buildContext } from './contextBuilder'
import { fetchFinanceNews, fetchGeneralNews } from './newsClient'
import { fetchWeather } from './weatherClient'
import { generateDisplay } from '../llm/index'
import { getSettings, hasRequiredKeys } from '../store/settings'
import { addToHistory } from '../store/history'

async function runCycleOnce(onResult) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45000)

  try {
    const context = buildContext()
    const settings = getSettings()

    if (!hasRequiredKeys()) {
      throw new Error('No API key configured')
    }

    let newsArticles = []
    if (settings.newsApiKey) {
      const symbols = [
        ...context.portfolio.holdings.map((h) => h.symbol),
        ...context.portfolio.watchlist.map((w) => w.symbol),
      ].filter(Boolean)

      const [financeNews, generalNews] = await Promise.all([
        fetchFinanceNews(settings.newsApiKey, symbols),
        fetchGeneralNews(settings.newsApiKey),
      ])

      const seen = new Set()
      for (const article of [...financeNews, ...generalNews]) {
        if (!seen.has(article.title)) {
          seen.add(article.title)
          newsArticles.push(article)
        }
      }
    }

    if (settings.weatherLat && settings.weatherLon) {
      try {
        context.weather = await fetchWeather(
          settings.weatherLat,
          settings.weatherLon,
          controller.signal,
        )
        context.weather.city = settings.weatherCity || null
      } catch (e) {
        console.warn('[AgentLoop] Weather fetch failed:', e.message)
      }
    }

    const { decision, contentType, html } = await generateDisplay(
      context,
      newsArticles,
      settings,
      controller.signal,
    )

    addToHistory({ type: contentType, summary: decision, timestamp: Date.now() })
    onResult({ html, decision, contentType })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function runCycle(onResult, onError) {
  try {
    await runCycleOnce(onResult)
  } catch (error) {
    console.error(`[${new Date().toISOString()}] AgentLoop error:`, error)
    if (error.message === 'No API key configured') {
      onError(error)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 60000))
    try {
      await runCycleOnce(onResult)
    } catch (retryError) {
      console.error(`[${new Date().toISOString()}] AgentLoop retry failed:`, retryError)
      onError(retryError)
    }
  }
}

export function startLoop(onResult, onError, intervalMinutes = 10) {
  runCycle(onResult, onError)
  const intervalId = setInterval(() => runCycle(onResult, onError), intervalMinutes * 60 * 1000)
  return () => clearInterval(intervalId)
}
