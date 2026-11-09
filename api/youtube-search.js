export default async function handler(req, res) {
  // CORS headers for local/cross-origin testing if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const query = (req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Parâmetro de busca "q" é obrigatório.' });
  }

  // 1. Optional: Use official YouTube Data API v3 if YOUTUBE_API_KEY is configured in environment
  if (process.env.YOUTUBE_API_KEY) {
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=8&q=${encodeURIComponent(
        query
      )}&key=${process.env.YOUTUBE_API_KEY}`;
      const apiRes = await fetch(apiUrl);
      if (apiRes.ok) {
        const apiData = await apiRes.json();
        const results = (apiData.items || []).map((item) => ({
          videoId: item.id?.videoId,
          title: item.snippet?.title,
          channel: item.snippet?.channelTitle,
          duration: '',
          thumbnail:
            item.snippet?.thumbnails?.default?.url ||
            item.snippet?.thumbnails?.medium?.url ||
            `https://i.ytimg.com/vi/${item.id?.videoId}/hqdefault.jpg`,
        }));
        if (results.length > 0) {
          return res.status(200).json({ results });
        }
      }
    } catch (err) {
      // Fall back to direct YouTube search parsing below
    }
  }

  // 2. Direct YouTube search page parsing (zero API key required)
  try {
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=pt-BR`;
    const response = await fetch(ytUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      throw new Error(`YouTube retornou status ${response.status}`);
    }

    const html = await response.text();
    const match =
      html.match(/var ytInitialData = (\{.*?\});<\/script>/s) ||
      html.match(/ytInitialData\s*=\s*(\{.*?\});<\/script>/s);

    if (!match) {
      throw new Error('Não foi possível extrair os resultados do YouTube.');
    }

    const data = JSON.parse(match[1]);
    const sectionContents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents || [];

    const videos = [];

    for (const section of sectionContents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        if (item.videoRenderer) {
          const v = item.videoRenderer;
          const videoId = v.videoId;
          const title =
            v.title?.runs?.map((r) => r.text).join('') ||
            v.title?.simpleText ||
            'Sem título';
          const channel =
            v.ownerText?.runs?.[0]?.text ||
            v.longBylineText?.runs?.[0]?.text ||
            v.shortBylineText?.runs?.[0]?.text ||
            '';
          const duration = v.lengthText?.simpleText || '';
          const thumbnail =
            v.thumbnail?.thumbnails?.[0]?.url ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

          if (videoId) {
            videos.push({
              videoId,
              title,
              channel,
              duration,
              thumbnail,
            });
          }
        }
        if (videos.length >= 8) break;
      }
      if (videos.length >= 8) break;
    }

    return res.status(200).json({ results: videos });
  } catch (error) {
    return res.status(500).json({
      error: 'Erro ao buscar vídeos no YouTube.',
      details: error.message,
    });
  }
}

