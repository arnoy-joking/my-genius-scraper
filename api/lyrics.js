import * as cheerio from 'cheerio';

export default async function handler(request, response) {
  // 1. Enable CORS (Optional but recommended for APIs)
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight requests for CORS
  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  // 2. Extract URL from query parameters
  // Usage: /api/lyrics?url=https://genius.com/...
  const { url: targetUrl } = request.query;

  // 3. Validation
  if (!targetUrl) {
    return response.status(400).json({ 
      error: 'Missing "url" query parameter. Usage: /api/lyrics?url=https://genius.com/...' 
    });
  }

  try {
    const parsedTarget = new URL(targetUrl);
    if (!parsedTarget.hostname.includes('genius.com')) {
      return response.status(400).json({ 
        error: 'Invalid domain. Only genius.com URLs are supported.' 
      });
    }
  } catch (e) {
    return response.status(400).json({ error: 'Invalid URL format.' });
  }

  try {
    // 4. Fetch the HTML
    // User-Agent is critical to avoid immediate blocking by Genius
    const fetchResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!fetchResponse.ok) {
      return response.status(fetchResponse.status).json({ 
        error: `Genius responded with status ${fetchResponse.status}` 
      });
    }

    const html = await fetchResponse.text();

    // 5. Parse HTML with Cheerio
    const $ = cheerio.load(html);
    let lyricsText = '';

    // Target the specific data attribute Genius uses for lyric containers
    const containers = $('[data-lyrics-container="true"]');

    if (containers.length === 0) {
      return response.status(404).json({ 
        error: 'No lyrics content found. The page might be instrumental or the layout has changed.' 
      });
    }

    containers.each((index, element) => {
      const container = $(element);

      // Convert <br> tags to newlines to preserve verse structure
      container.find('br').replaceWith('\n');

      // Optional: Remove empty elements that might create noise
      container.find('div, span').each((i, el) => {
          if($(el).text().trim() === '') $(el).remove();
      });

      // Accumulate text with spacing
      lyricsText += container.text().trim() + '\n\n';
    });

    // 6. Clean the text
    const cleanLyrics = lyricsText
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
      .replace(/(\S)(\[)/g, '$1\n\n$2')      // Ensure headers like [Verse] have space above
      .replace(/(\n\s*){3,}/g, '\n\n')       // Limit max newlines to 2
      .trim();

    // 7. Return plain text response
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // Set Vercel Edge Cache (Cache for 1 hour)
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    
    return response.status(200).send(cleanLyrics);

  } catch (error) {
    console.error(error);
    return response.status(500).json({ 
      error: 'Internal Server Error', 
      details: error.message 
    });
  }
}