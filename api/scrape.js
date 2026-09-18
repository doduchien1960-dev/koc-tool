export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ chấp nhận POST' });

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Thiếu liên kết' });

  const cleanUrl = url.trim();
  const uLower = cleanUrl.toLowerCase();

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  function parseVnNumber(valStr) {
    if (!valStr) return 0;
    let s = String(valStr).trim().toLowerCase();
    let mult = 1;
    if (s.includes('k')) { mult = 1000; s = s.replace(/k/g, ''); }
    else if (s.includes('m') || s.includes('tr') || s.includes('triệu')) {
      mult = 1000000;
      s = s.replace(/m|tr|triệu/g, '');
    }
    s = s.replace(/,/g, '.');
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length === 3 && mult === 1) {
      s = parts[0] + parts[1];
    }
    const found = s.match(/[0-9.]+/);
    return found ? Math.round(parseFloat(found[0]) * mult) : 0;
  }

  // =========================================================================
  // BƯỚC 1: ƯU TIÊN GỌI ENDPOINT PROXY (VƯỢT LOGIN WALL META / THREADS / FB)
  // =========================================================================
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000); // Giới hạn 7 giây để an toàn cho Vercel

    const proxyRes = await fetch('https://vercel-light-ashy.vercel.app/api/crawler/one', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': HEADERS['User-Agent'],
        'Referer': 'https://vercel-light-ashy.vercel.app/'
      },
      body: JSON.stringify({ url: cleanUrl, force: false }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data && data.ok) {
        let platformName = 'Other';
        if (uLower.includes('tiktok.com')) platformName = 'TikTok';
        else if (uLower.includes('youtube.com') || uLower.includes('youtu.be')) platformName = 'YouTube';
        else if (uLower.includes('facebook.com') || uLower.includes('fb.watch')) platformName = 'Facebook';
        else if (uLower.includes('threads.net') || uLower.includes('threads.com')) platformName = 'Threads';

        return res.status(200).json({
          platform: data.platform || platformName,
          author: data.author || 'KOL / KOC',
          url: cleanUrl,
          likes: parseInt(data.like || data.likes) || 0,
          comments: parseInt(data.comment || data.comments) || 0,
          shares: parseInt(data.share || data.shares) || 0,
          views: parseInt(data.view || data.views) || 0
        });
      }
    }
  } catch (proxyErr) {
    // Nếu proxy timeout hoặc lỗi, tự động trôi xuống tầng Fallback bên dưới
    console.warn('Proxy crawler bận, chuyển sang fallback nội bộ:', proxyErr.message);
  }

  // =========================================================================
  // BƯỚC 2: TẦNG DỰ PHÒNG (FALLBACK CASCADE)
  // =========================================================================
  try {
    // Fallback YouTube
    if (uLower.includes('youtube.com') || uLower.includes('youtu.be')) {
      const vidMatch = cleanUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
      const vid = vidMatch ? vidMatch[1] : null;
      let author = 'YouTube Channel', views = 0, likes = 0;

      if (vid) {
        try {
          const oRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vid}&format=json`);
          if (oRes.ok) {
            const oData = await oRes.json();
            if (oData.author_name) author = oData.author_name;
          }
        } catch (e) {}

        try {
          const rRes = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${vid}`);
          if (rRes.ok) {
            const rData = await rRes.json();
            if (rData.viewCount !== undefined) views = parseInt(rData.viewCount) || 0;
            if (rData.likes !== undefined) likes = parseInt(rData.likes) || 0;
          }
        } catch (e) {}
      }

      return res.status(200).json({ platform: 'YouTube', author, url: cleanUrl, likes, comments: 0, shares: 0, views });
    }

    // Fallback TikTok
    if (uLower.includes('tiktok.com')) {
      let author = 'TikTok KOL', views = 0, likes = 0, comments = 0, shares = 0;
      try {
        const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`);
        if (tikRes.ok) {
          const tikData = await tikRes.json();
          if (tikData.code === 0 && tikData.data) {
            const d = tikData.data;
            author = d.author?.nickname || d.author?.unique_id || author;
            views = d.play_count || 0;
            likes = d.digg_count || 0;
            comments = d.comment_count || 0;
            shares = d.share_count || 0;
          }
        }
      } catch (e) {}

      return res.status(200).json({ platform: 'TikTok', author, url: cleanUrl, likes, comments, shares, views });
    }

    // Fallback Threads
    if (uLower.includes('threads.net') || uLower.includes('threads.com')) {
      const fixedUrl = cleanUrl.replace('threads.com', 'threads.net');
      let author = 'Threads User', views = 0, likes = 0, comments = 0, shares = 0;

      try {
        const oRes = await fetch(`https://www.threads.net/oembed?url=${encodeURIComponent(fixedUrl)}`);
        if (oRes.ok) {
          const oData = await oRes.json();
          if (oData.author_name) author = '@' + oData.author_name;
        }
      } catch (e) {}

      try {
        const pageRes = await fetch(fixedUrl, { headers: HEADERS });
        const html = await pageRes.text();
        const likeM = html.match(/"like_count":(\d+)/);
        const replyM = html.match(/"reply_count":(\d+)/) || html.match(/"direct_reply_count":(\d+)/);
        const repostM = html.match(/"repost_count":(\d+)/);

        if (likeM) likes = parseInt(likeM[1]) || 0;
        if (replyM) comments = parseInt(replyM[1]) || 0;
        if (repostM) shares = parseInt(repostM[1]) || 0;

        const ogDesc = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i);
        if (ogDesc) {
          const desc = ogDesc[1];
          const lMatch = desc.match(/([0-9.,]+[kKmMtr]*)\s*(?:likes|lượt thích|thích)/i);
          const cMatch = desc.match(/([0-9.,]+[kKmMtr]*)\s*(?:replies|bình luận|comments)/i);
          const vMatch = desc.match(/([0-9.,]+[kKmMtr]*)\s*(?:views|lượt xem)/i);
          if (lMatch && likes === 0) likes = parseVnNumber(lMatch[1]);
          if (cMatch && comments === 0) comments = parseVnNumber(cMatch[1]);
          if (vMatch && views === 0) views = parseVnNumber(vMatch[1]);
        }
      } catch (e) {}

      return res.status(200).json({ platform: 'Threads', author, url: cleanUrl, likes, comments, shares, views });
    }

    // Fallback Facebook
    let author = 'Facebook Page', views = 0, likes = 0, comments = 0, shares = 0;
    try {
      const fbRes = await fetch(cleanUrl, { headers: HEADERS });
      const html = await fbRes.text();

      const titleM = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
      if (titleM) {
        const rawTitle = titleM[1];
        if (!rawTitle.includes('Facebook') && !rawTitle.includes('Log in')) {
          author = rawTitle.split('|')[0].split('-')[0].split('•')[0].trim();
        }
      }

      const reactionM = html.match(/"reaction_count":\{"count":(\d+)\}/) || html.match(/"i18n_reaction_count":"([^"]+)"/);
      const commentM = html.match(/"total_comment_count":(\d+)/) || html.match(/"comment_count":\{"total_count":(\d+)\}/);
      const shareM = html.match(/"share_count":\{"count":(\d+)\}/) || html.match(/"i18n_share_count":"([^"]+)"/);
      const viewM = html.match(/video_view_count":(\d+)/) || html.match(/"play_count":(\d+)/);

      if (reactionM) likes = parseVnNumber(reactionM[1]);
      if (commentM) comments = parseVnNumber(commentM[1]);
      if (shareM) shares = parseVnNumber(shareM[1]);
      if (viewM) views = parseVnNumber(viewM[1]);

      const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
      if (ogDesc) {
        const desc = ogDesc[1];
        const lMatch = desc.match(/([0-9.,]+[kKmMtr]*)\s*(?:like|lượt thích|thích|reactions)/i);
        const cMatch = desc.match(/([0-9.,]+[kKmMtr]*)\s*(?:comment|bình luận|cmt)/i);
        const sMatch = desc.match(/([0-9.,]+[kKmMtr]*)\s*(?:share|chia sẻ)/i);
        const vMatch = desc.match(/([0-9.,]+[kKmMtr]*)\s*(?:view|lượt xem|xem)/i);

        if (lMatch && likes === 0) likes = parseVnNumber(lMatch[1]);
        if (cMatch && comments === 0) comments = parseVnNumber(cMatch[1]);
        if (sMatch && shares === 0) shares = parseVnNumber(sMatch[1]);
        if (vMatch && views === 0) views = parseVnNumber(vMatch[1]);
      }
    } catch (e) {}

    return res.status(200).json({ platform: 'Facebook', author, url: cleanUrl, likes, comments, shares, views });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
