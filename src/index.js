import * as cheerio from 'cheerio';

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Error: Missing ?url= parameter', { status: 400, headers: corsHeaders });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          // Robust User-Agent to look like a real browser
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Referer': 'https://www.google.com/',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      if (!response.ok) {
        return new Response(`Error: Genius status ${response.status}`, { status: response.status, headers: corsHeaders });
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      let lyrics = '';

      // 1. Primary Selector: This is the specific container for lyrics text
      const containers = $('[data-lyrics-container="true"]');

      if (containers.length > 0) {
        containers.each((i, el) => {
          const block = $(el);
          
          // Replace <br> tags with newlines
          block.find('br').replaceWith('\n');
          
          // Remove potential ad/empty divs inside the lyrics container
          block.find('div[class*="Defered"]').remove();
          block.find('div[class*="Inread"]').remove();
          
          // Get text
          lyrics += block.text() + '\n\n';
        });
      } else {
        // Fallback: If data-lyrics-container is missing, try scraping generic lyric classes
        // (This is rare but happens on older pages)
        $('.lyrics, div[class*="Lyrics__Container"]').each((i, el) => {
           const block = $(el);
           block.find('br').replaceWith('\n');
           lyrics += block.text() + '\n\n';
        });
      }

      if (!lyrics.trim()) {
        return new Response('Error: Lyrics not found', { status: 404, headers: corsHeaders });
      }

      // --- CLEANING SECTION ---
      let cleanLyrics = lyrics
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
        
        // FIX: Remove the "Contributors/Translations" header junk
        // This Regex looks for the pattern where "Contributors" and "Lyrics" text appear before the first bracket [
        .replace(/^.*?Contributors.*?Lyrics\s*(?=\[)/s, '') 
        .replace(/^.*?Translations.*?Lyrics\s*(?=\[)/s, '')
        
        // Ensure headers like [Verse 1] have a newline before them
        .replace(/([^\n])(\[)/g, '$1\n\n$2')
        
        // Remove excessive newlines
        .replace(/\n{3,}/g, '\n\n')
        .trim();

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
