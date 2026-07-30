export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { url1, url2 } = req.body;

  if (!url1 || !url2) {
    return res.status(400).json({ error: 'As duas URLs são obrigatórias.' });
  }

  const fetchHtml = async (url) => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Falha ao carregar a página (Status: ${response.status})`);
      }
      
      let text = await response.text();
      text = text.replace(/<meta\s+(?:[^>]*\s+)?http-equiv=["']?content-security-policy(-report-only)?["']?[^>]*>/gi, '');
      return { html: text, error: null };
    } catch (err) {
      return { html: null, error: err.message };
    }
  };

  const [site1, site2] = await Promise.all([
    fetchHtml(url1),
    fetchHtml(url2),
  ]);

  if (site1.error || site2.error) {
    return res.status(403).json({ 
      error: 'site_privado', 
      message: 'Um dos sites está privado, bloqueando acesso ou é incompatível com a requisição.',
      details: { site1: site1.error, site2: site2.error }
    });
  }

  return res.status(200).json({
    html1: site1.html,
    html2: site2.html,
  });
}
