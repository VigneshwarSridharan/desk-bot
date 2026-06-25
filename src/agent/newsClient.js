const NEWS_BASE_URL = 'https://newsapi.org/v2/everything'

export async function fetchFinanceNews(apiKey, symbols = []) {
  try {
    const baseTopics = ['Indian stock market', 'Nifty 50', 'BSE Sensex', 'mutual funds India']
    const symbolPart = symbols.length > 0 ? symbols.join(' OR ') + ' OR ' : ''
    const query = symbolPart + baseTopics.join(' OR ')

    const params = new URLSearchParams({
      q: query,
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: '10',
    })

    const response = await fetch(`${NEWS_BASE_URL}?${params}`, {
      headers: { 'X-Api-Key': apiKey },
    })

    if (!response.ok) {
      console.warn(`[NewsAPI] fetchFinanceNews error ${response.status}`)
      return []
    }
    const data = await response.json()
    return (data.articles || []).map((a) => ({
      title: a.title,
      description: a.description,
      url: a.url,
      publishedAt: a.publishedAt,
      source: a.source?.name,
    }))
  } catch (error) {
    console.error('fetchFinanceNews error:', error)
    return []
  }
}

export async function fetchGeneralNews(apiKey) {
  try {
    const params = new URLSearchParams({
      q: 'artificial intelligence OR fintech OR technology India',
      language: 'en',
      sortBy: 'publishedAt',
      pageSize: '5',
    })

    const response = await fetch(`${NEWS_BASE_URL}?${params}`, {
      headers: { 'X-Api-Key': apiKey },
    })

    if (!response.ok) {
      console.warn(`[NewsAPI] fetchGeneralNews error ${response.status}`)
      return []
    }
    const data = await response.json()
    return (data.articles || []).map((a) => ({
      title: a.title,
      description: a.description,
      url: a.url,
      publishedAt: a.publishedAt,
      source: a.source?.name,
    }))
  } catch (error) {
    console.error('fetchGeneralNews error:', error)
    return []
  }
}
