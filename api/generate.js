export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });

  try {
    const { prompt, profile, imageUrls } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt obrigatório.' });

    // PASSO 1: Se tem imagens, descreve elas rapidamente (chamada separada e rápida)
    let imageDescription = '';
    if (imageUrls && imageUrls.length > 0) {
      try {
        const descParts = [
          { text: 'Descreva em detalhes o que você vê nestas imagens: produtos, pessoas, cores, texturas, iluminação, ambiente, estilo visual. Seja específico e objetivo. Responda em português em no máximo 200 palavras.' }
        ];
        for (const url of imageUrls) {
          descParts.push({ file_data: { file_uri: url, mime_type: 'image/jpeg' } });
        }
        const descResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: descParts }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 300 }
            })
          }
        );
        const descData = await descResp.json();
        imageDescription = descData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch(e) {
        imageDescription = '';
      }
    }

    // PASSO 2: Gera o conteúdo com a descrição das imagens incluída no prompt
    const systemPrompt = buildSystemPrompt(profile);
    const fullPrompt = systemPrompt + '\n\n' + prompt +
      (imageDescription ? '\n\nDESCRIÇÃO DAS FOTOS DE REFERÊNCIA ENVIADAS:\n' + imageDescription + '\n\nUse esta descrição para criar prompts de imagem FIÉIS ao que foi descrito acima.' : '');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 6000 }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erro Gemini' });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(200).json({ error: 'Resposta sem JSON. Tente novamente.' });

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const versoes = parsed.versoes || parsed.versões || [];
      return res.status(200).json({ versoes });
    } catch(e) {
      try {
        const fixed = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
        const parsed = JSON.parse(fixed);
        return res.status(200).json({ versoes: parsed.versoes || parsed.versões || [] });
      } catch(e2) {
        return res.status(200).json({ error: 'Erro ao processar. Tente novamente.' });
      }
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
      cores: "amarelo #F7C948, verde tiffany #3DBFA8, navy #1B2E4B, rosa #F0A0B8",
      simbolo: "abelha com coroa",
      hashtags: "#confeitaria #annesconfeitaria #bolopersonalizado #docesartesanais #salgados #kitsfesta #encomendas #doceria"
    },
    ftec: {
      name: "FreedomTec Engenharia",
      desc: "Engenharia e Serviços Técnicos para mineração — reformas de componentes, limpeza dielétrica, faróis Altezza e Berg Steel.",
      tom: "técnico, profissional, didático e direto",
      cores: "navy #0d1f2d, dourado #c9a84c, prata #c0c0c0",
      simbolo: "velas náuticas douradas",
      hashtags: "#freedomtec #engenharia #mineracao #reformadecomponentes #limpezadieletrica #altezza #bergsteel #industria"
    },
    leudy: {
      name: "Leudy Veloso",
      desc: "Marketing e Inovação com IA — tecnologia, gastronomia, lifestyle, ensaios pessoais.",
      tom: "leve, reflexivo, dinâmico e moderno",
      cores: "bordô #8b0000, dourado #c9a84c, preto #1a1a1a",
      simbolo: "beija-flor dourado",
      hashtags: "#leudyveloso #marketingdigital #inteligenciaartificial #gastronomia #lifestyle #inovacao #techlife"
    }
  };

  const p = profiles[profile] || profiles.leudy;

  return `Você é especialista em marketing digital criando conteúdo para ${p.name}.
PERFIL: ${p.desc}
TOM: ${p.tom}
CORES: ${p.cores}
SÍMBOLO: ${p.simbolo}
HASHTAGS BASE: ${p.hashtags}

Responda APENAS com JSON puro válido, sem markdown.

{"versoes":[{"legenda":"legenda completa com emojis e CTA (min 120 palavras)","imgEn":"detailed English image prompt","imgPt":"prompt detalhado em português","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"roteiro 30s Reels com cenas numeradas"},{"legenda":"segunda versão","imgEn":"...","imgPt":"...","hashtags":["#tag1"],"roteiro":"..."},{"legenda":"terceira versão","imgEn":"...","imgPt":"...","hashtags":["#tag1"],"roteiro":"..."}]}`;
}
