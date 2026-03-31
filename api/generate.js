export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });

  try {
    const { prompt, profile, images } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt obrigatório.' });

    const systemPrompt = buildSystemPrompt(profile);
    const fullText = systemPrompt + '\n\n' + prompt;

    // Build parts array — text first, then images if provided
    const parts = [{ text: fullText }];

    if (images && images.length > 0) {
      for (const img of images) {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.data
          }
        });
      }
      parts.push({
        text: `\nANÁLISE DAS IMAGENS DE REFERÊNCIA:
Analise cuidadosamente as imagens enviadas e:
1. Identifique os produtos, pessoas, ambiente, cores, iluminação e estilo visual
2. Use essas características REAIS para criar os prompts de imagem (imgEn e imgPt)
3. Os prompts devem reproduzir fielmente o estilo, produtos e pessoas das fotos
4. Descreva cores reais, texturas, composição e atmosfera que você viu nas imagens
5. Para a legenda, mencione os produtos/elementos específicos que aparecem nas fotos`
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 4000 }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erro Gemini' });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try { return res.status(200).json(JSON.parse(clean)); }
    catch { return res.status(200).json({ raw: text }); }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function buildSystemPrompt(profile) {
  const profiles = {
    annes: {
      name: "Anne's Confeitaria",
      desc: "Confeitaria artesanal — bolos personalizados, doces finos, salgados, kits festas e corporativos. Público: famílias, empresas e datas comemorativas.",
      tom: "descontraído, acolhedor, elegante e vendedor",
      cores: "amarelo vibrante #F7C948, verde tiffany #3DBFA8, azul navy #1B2E4B, rosa #F0A0B8",
      simbolo: "abelha com coroa",
      hashtags: "#confeitaria #annesconfeitaria #bolopersonalizado #docesartesanais #salgados #kitsfesta #confeitariaartesanal #encomendas #doceria #bolosdecor"
    },
    ftec: {
      name: "FreedomTec Engenharia",
      desc: "Engenharia e Serviços Técnicos para mineração — reformas de componentes elétricos, limpeza dielétrica, representação de faróis Altezza e Berg Steel.",
      tom: "técnico, profissional, didático e direto",
      cores: "azul navy #0d1f2d, dourado #c9a84c, prata #c0c0c0",
      simbolo: "velas náuticas douradas",
      hashtags: "#freedomtec #engenharia #mineracao #reformadecomponentes #limpezadieletrica #altezza #bergsteel #industria #manutencaoindustrial"
    },
    leudy: {
      name: "Leudy Veloso",
      desc: "Marketing e Inovação com IA — tecnologia, gastronomia e lifestyle, ensaios pessoais, criatividade e imagens conceituais.",
      tom: "leve, reflexivo, dinâmico e moderno",
      cores: "bordô #8b0000, dourado #c9a84c, preto #1a1a1a",
      simbolo: "beija-flor dourado",
      hashtags: "#leudyveloso #marketingdigital #inteligenciaartificial #gastronomia #lifestyle #criatividade #inovacao #techlife #ia"
    }
  };

  const p = profiles[profile] || profiles.leudy;

  return `Você é especialista em marketing digital criando conteúdo para ${p.name}.

PERFIL: ${p.desc}
TOM DE VOZ: ${p.tom}
CORES DA MARCA: ${p.cores}
SÍMBOLO: ${p.simbolo}
HASHTAGS BASE: ${p.hashtags}

INSTRUÇÕES:
- Responda APENAS com JSON puro e válido, sem markdown, sem explicações
- Gere exatamente 3 versões diferentes e criativas
- Se houver imagens de referência, use os elementos REAIS das fotos nos prompts
- Os prompts de imagem devem ser detalhados e reproduzir fielmente o estilo visual

JSON obrigatório:
{"versoes":[{"legenda":"legenda completa com emojis, parágrafos e CTA (mínimo 120 palavras)","imgEn":"detailed English image prompt based on reference photos if provided","imgPt":"prompt detalhado em português baseado nas fotos de referência se fornecidas","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"roteiro de 30s para Reels/Stories com cenas numeradas e falas"},{"legenda":"segunda versão diferente","imgEn":"second prompt","imgPt":"segundo prompt","hashtags":["#tag1"],"roteiro":"segundo roteiro"},{"legenda":"terceira versão diferente","imgEn":"third prompt","imgPt":"terceiro prompt","hashtags":["#tag1"],"roteiro":"terceiro roteiro"}]}`;
}
