import * as cheerio from 'cheerio';

export default {
  async fetch(request, env, ctx) {
    // 1. Setup CORS to allow calling this from any website
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    // Handle Preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Parse the URL parameter
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Error: Missing ?url= parameter', { status: 400, headers: corsHeaders });
    }

    try {
      // 3. Fetch with browser-like headers (Spoofing)
      // This is crucial to bypass 403 errors. We pretend to come from Google search.
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      if (!response.ok) {
        // If Genius blocks us (403), return the error clearly
        return new Response(`Error: Genius returned status ${response.status}. Anti-bot protection active.`, { 
          status: response.status,
          headers: corsHeaders 
        });
      }

      const html = await response.text();

      // 4. Parse with Cheerio
      const $ = cheerio.load(html);
      
      // Variable to hold the final string
      let lyrics = '';

      // Genius uses these specific data attributes for lyrics containers
      const containers = $('[data-lyrics-container="true"]');

      if (containers.length === 0) {
        // Check if it's an instrumental
        if ($('h1').text().toLowerCase().includes('instrumental')) {
           return new Response('[Instrumental]', { headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        return new Response('Error: Could not find lyrics content on this page.', { status: 404, headers: corsHeaders });
      }

      containers.each((i, el) => {
        const block = $(el);
        
        // Replace <br> tags with actual newline characters
        block.find('br').replaceWith('\n');
        
        // Remove ads or empty divs that Genius inserts
        block.find('div[class*="Defered"]').remove();
        
        // Get text and add double newline between blocks
        lyrics += block.text() + '\n\n';
      });

      // 5. Cleanup Text
      const cleanLyrics = lyrics
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
        .replace(/\n{3,}/g, '\n\n')            // Max 2 newlines
        .trim();

      // 6. Return Success
      return new Response(cleanLyrics, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...corsHeaders
        }
      });

    } catch (err) {
      return new Response(`Server Error: ${err.message}`, { status: 500, headers: corsHeaders });
    }
  }
};