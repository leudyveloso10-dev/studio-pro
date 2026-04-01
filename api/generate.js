export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chave não configurada' });

  try {
    const { prompt, profile, images } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt obrigatório.' });

    const parts = [{ text: buildSystemPrompt(profile) + '\n\n' + prompt }];

    if (images && images.length > 0) {
      for (const img of images) {
        if (img && img.data && img.mimeType) {
          parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
        }
      }
      parts.push({ text: 'Analise as imagens e use os elementos visuais reais para criar os prompts.' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erro Gemini' });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Find JSON in response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(200).json({ error: 'Resposta sem JSON válido: ' + text.substring(0, 100) });
    
    const clean = jsonMatch[0];
    
    try {
      const parsed = JSON.parse(clean);
      const versoes = parsed.versoes || parsed.versões || parsed.versions || [];
      return res.status(200).json({ versoes });
    } catch(e) {
      return res.status(200).json({ error: 'JSON inválido: ' + e.message });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function buildSystemPrompt(profile) {
  const profiles = {
    annes: {
      name: "Anne's Confeitaria",
      desc: "Confeitaria artesanal — bolos personalizados, doces finos, salgados, kits festas e corporativos.",
      tom: "descontraído, acolhedor, elegante e vendedor",
      cores: "amarelo #F7C948, verde tiffany #3DBFA8, navy #1B2E4B",
      hashtags: "#confeitaria #annesconfeitaria #bolopersonalizado #docesartesanais #salgados #kitsfesta #encomendas"
    },
    ftec: {
      name: "FreedomTec Engenharia",
      desc: "Engenharia e Serviços Técnicos — reformas de componentes, limpeza dielétrica, faróis Altezza e Berg Steel. Clientes: mineração.",
      tom: "técnico, profissional, didático e direto",
      cores: "navy #0d1f2d, dourado #c9a84c, prata #c0c0c0",
      hashtags: "#freedomtec #engenharia #mineracao #reformadecomponentes #limpezadieletrica #altezza #bergsteel"
    },
    leudy: {
      name: "Leudy Veloso",
      desc: "Marketing e Inovação com IA — tecnologia, gastronomia, lifestyle, ensaios pessoais.",
      tom: "leve, reflexivo, dinâmico e moderno",
      cores: "bordô #8b0000, dourado #c9a84c, preto #1a1a1a",
      hashtags: "#leudyveloso #marketingdigital #inteligenciaartificial #gastronomia #lifestyle #inovacao"
    }
  };

  const p = profiles[profile] || profiles.leudy;

  return `Você é especialista em marketing digital criando conteúdo para ${p.name}.
PERFIL: ${p.desc}
TOM: ${p.tom}
CORES: ${p.cores}
HASHTAGS BASE: ${p.hashtags}

IMPORTANTE: Responda APENAS com JSON puro. Sem texto antes ou depois. Sem markdown.

Formato exato:
{"versoes":[{"legenda":"legenda completa com emojis e CTA forte (minimo 100 palavras)","imgEn":"detailed English image prompt","imgPt":"prompt detalhado em português","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"roteiro 30s para Reels com cenas numeradas e falas"},{"legenda":"segunda versao diferente","imgEn":"second prompt","imgPt":"segundo prompt","hashtags":["#tag1","#tag2"],"roteiro":"segundo roteiro"},{"legenda":"terceira versao diferente","imgEn":"third prompt","imgPt":"terceiro prompt","hashtags":["#tag1","#tag2"],"roteiro":"terceiro roteiro"}]}`;
}
