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

  // Nhận diện nền tảng
  let detectedPlatform = 'Facebook';
  if (uLower.includes('tiktok.com')) detectedPlatform = 'TikTok';
  else if (uLower.includes('youtube.com') || uLower.includes('youtu.be')) detectedPlatform = 'YouTube';
  else if (uLower.includes('threads.net') || uLower.includes('threads.com')) detectedPlatform = 'Threads';

  // =========================================================================
  // CHIẾN LƯỢC 1: Gọi trực tiếp động cơ crawler chuyên dụng (Xử lý Facebook & Threads)
  // =========================================================================
  try {
    const crawlerRes = await fetch('https://vercel-light-ashy.vercel.app/api/crawler/one', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({ url: cleanUrl, force: false })
    });

    if (crawlerRes.ok) {
      const data = await crawlerRes.json();
      // Nếu động cơ trả về thành công và không lỗi
      if (data && (data.ok === true || data.view !== undefined || data.like !== undefined)) {
        let pName = data.platform || detectedPlatform;
        pName = pName.charAt(0).toUpperCase() + pName.slice(1);

        return res.status(200).json({
          platform: pName,
          author: data.author || 'KOL / Page',
          url: cleanUrl,
          likes: data.like || 0,
          comments: data.comment || 0,
          shares: data.share || 0,
          views: data.view || 0
        });
      }
    }
  } catch (e) {
    console.error('Lỗi crawler chính, chuyển sang cơ chế dự phòng:', e);
  }

  // =========================================================================
  // CHIẾN LƯỢC 2: Bộ dự phòng tự động (Dành cho TikTok & YouTube nếu cần)
  // =========================================================================
  try {
    // Dự phòng TikTok
    if (detectedPlatform === 'TikTok') {
      const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`);
      if (tikRes.ok) {
        const tikData = await tikRes.json();
        if (tikData.code === 0 && tikData.data) {
          const d = tikData.data;
          return res.status(200).json({
            platform: 'TikTok',
            author: d.author?.nickname || d.author?.unique_id || 'TikTok KOL',
            url: cleanUrl,
            likes: d.digg_count || 0,
            comments: d.comment_count || 0,
            shares: d.share_count || 0,
            views: d.play_count || 0
          });
        }
      }
    }

    // Dự phòng YouTube
    if (detectedPlatform === 'YouTube') {
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

      return res.status(200).json({
        platform: 'YouTube',
        author,
        url: cleanUrl,
        likes,
        comments: 0,
        shares: 0,
        views
      });
    }
  } catch (err) {}

  // Trả về mặc định nếu không lấy được
  return res.status(200).json({
    platform: detectedPlatform,
    author: 'KOL / Page',
    url: cleanUrl,
    likes: 0,
    comments: 0,
    shares: 0,
    views: 0
  });
}
