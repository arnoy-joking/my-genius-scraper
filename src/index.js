import * as cheerio from 'cheerio';

export default {
  async fetch(request, env, ctx) {
    // 1. CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const urlObj = new URL(request.url);
    const directUrl = urlObj.searchParams.get('url');
    const query = urlObj.searchParams.get('q');
    const apiKey = urlObj.searchParams.get('key'); // Genius Client Access Token

    let targetUrl = null;
    let songMetadata = null; // To store title/artist if we searched

    try {
      // --- PHASE 1: URL RESOLUTION ---
      
      if (directUrl) {
        // Mode A: Direct URL
        targetUrl = directUrl;
      } else if (query && apiKey) {
        // Mode B: Search via API
        const searchApiUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
        
        const searchReq = await fetch(searchApiUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        });

        if (!searchReq.ok) {
          return new Response(`Error: Genius API error ${searchReq.status}`, { status: searchReq.status, headers: corsHeaders });
        }

        const searchData = await searchReq.json();
        
        // Validation: Did we find any hits?
        if (!searchData.response || !searchData.response.hits || searchData.response.hits.length === 0) {
          return new Response('Error: No songs found for this query', { status: 404, headers: corsHeaders });
        }

        // Get the top result
        const topHit = searchData.response.hits[0].result;
        targetUrl = topHit.url;
        songMetadata = topHit.full_title; // e.g. "Broken Angel by Arash"

      } else {
        return new Response('Error: Provide either "?url=..." OR "?q=...&key=..."', { status: 400, headers: corsHeaders });
      }

      // --- PHASE 2: SCRAPING (The Robust Logic) ---

      // Validation: Ensure we actually have a URL now
      if (!targetUrl || !targetUrl.includes('genius.com')) {
        return new Response('Error: Invalid URL resolved. Must be a genius.com link.', { status: 400, headers: corsHeaders });
      }

      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Referer': 'https://www.google.com/', // Critical for bypassing 403
          'Upgrade-Insecure-Requests': '1'
        }
      });

      if (!response.ok) {
        return new Response(`Error: Scraping failed with status ${response.status}`, { status: response.status, headers: corsHeaders });
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      let lyrics = '';

      // Target specific lyrics containers
      const containers = $('[data-lyrics-container="true"]');

      if (containers.length > 0) {
        containers.each((i, el) => {
          const block = $(el);

          // 1. Remove "Contributors/Translations" header (nested inside data-exclude-from-selection)
          block.find('[data-exclude-from-selection="true"]').remove();
          
          // 2. Remove ads and expandable buttons
          block.find('div[class*="Defered"]').remove();
          block.find('div[class*="Inread"]').remove();
          block.find('div[class*="ExpandableContent"]').remove();

          // 3. Convert breaks to newlines
          block.find('br').replaceWith('\n');
          
          lyrics += block.text() + '\n\n';
        });
      } else {
        // Fallback for older pages
        $('.lyrics').each((i, el) => {
           const block = $(el);
           block.find('br').replaceWith('\n');
           lyrics += block.text() + '\n\n';
        });
      }

      if (!lyrics.trim()) {
        // Check if it's an instrumental
        const isInstrumental = $('h1').text().toLowerCase().includes('instrumental') || 
                               $('.Lyrics__Container').text().toLowerCase().includes('instrumental');
        
        if (isInstrumental) {
           lyrics = "[Instrumental]";
        } else {
           return new Response('Error: Lyrics not found (Page layout might differ)', { status: 404, headers: corsHeaders });
        }
      }

      // --- POST PROCESSING CLEANUP ---
      let cleanLyrics = lyrics
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
        // Ensure headers like [Verse 1] have a newline before them
        .replace(/([^\n])(\[)/g, '$1\n\n$2')
        // Remove excessive newlines
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Add Metadata header if we performed a search (helps you verify which song was picked)
      const finalHeaders = {
        'Content-Type': 'text/plain; charset=utf-8',
        ...corsHeaders
      };

      if (songMetadata) {
        finalHeaders['X-Genius-Song-Title'] = songMetadata;
        finalHeaders['X-Genius-Song-Url'] = targetUrl;
      }

      return new Response(cleanLyrics, {
        headers: finalHeaders
      });

    } catch (err) {
      return new Response(`Server Error: ${err.message}`, { status: 500, headers: corsHeaders });
    }
  }
};
