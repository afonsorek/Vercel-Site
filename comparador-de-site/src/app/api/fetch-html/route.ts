import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { url1, url2 } = await request.json();

    if (!url1 || !url2) {
      return NextResponse.json(
        { error: 'As duas URLs são obrigatórias.' },
        { status: 400 }
      );
    }

    const fetchHtml = async (url: string) => {
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
        
        const text = await response.text();
        return { html: text, error: null };
      } catch (err: any) {
        return { html: null, error: err.message };
      }
    };

    const [site1, site2] = await Promise.all([
      fetchHtml(url1),
      fetchHtml(url2),
    ]);

    if (site1.error || site2.error) {
      return NextResponse.json(
        { 
          error: 'site_privado', 
          message: 'Um dos sites está privado, bloqueando acesso ou é incompatível com a requisição.',
          details: { site1: site1.error, site2: site2.error }
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      html1: site1.html,
      html2: site2.html,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro interno no servidor.' },
      { status: 500 }
    );
  }
}
