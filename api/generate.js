export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Vercel.' });

  try {
    const { prompt, profile } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt obrigatório.' });

    const systemPrompt = buildSystemPrompt(profile);
    const fullPrompt = systemPrompt + '\n\n' + prompt;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 4000 }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erro na API Gemini' });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    } catch {
      return res.status(200).json({ raw: text });
    }

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
      simbolo: "abelha com coroa — artesanal, personalizado, rainha da confeitaria",
      hashtags: "#confeitaria #annesconfeitaria #bolopersonalizado #docesartesanais #salgados #kitsfesta #confeitariaartesanal #encomendas #doceria #bolosdecor",
      estilo_img: "warm pastel food photography, yellow and tiffany green tones, artisan bakery, cozy handmade aesthetic, bee crown motif, soft natural light"
    },
    ftec: {
      name: "FreedomTec Engenharia",
      desc: "Engenharia e Serviços Técnicos para mineração. Reformas de componentes elétricos, limpeza dielétrica, representação de faróis Altezza e Berg Steel.",
      tom: "técnico, profissional, didático e direto",
      cores: "azul navy #0d1f2d, dourado #c9a84c, prata #c0c0c0",
      simbolo: "velas náuticas douradas — precisão, movimento, liberdade técnica",
      hashtags: "#freedomtec #engenharia #mineracao #reformadecomponentes #limpezadieletrica #altezza #bergsteel #industria #manutencaoindustrial #servicostecnicos",
      estilo_img: "industrial technical photography, dark navy and gold tones, precision machinery, mining industry, professional engineering aesthetic"
    },
    leudy: {
      name: "Leudy Veloso",
      desc: "Marketing e Inovação com IA. Tecnologia, gastronomia e lifestyle, ensaios pessoais e reflexões, criatividade e imagens conceituais.",
      tom: "leve, reflexivo, dinâmico e moderno",
      cores: "bordô #8b0000, dourado #c9a84c, preto #1a1a1a",
      simbolo: "beija-flor dourado — elegância, velocidade, inovação, liberdade",
      hashtags: "#leudyveloso #marketingdigital #inteligenciaartificial #gastronomia #lifestyle #criatividade #inovacao #techlife #ia #marketinginovacao",
      estilo_img: "editorial portrait, deep red and gold tones, futuristic digital art, hummingbird motif, split-face tech concept, elegant lifestyle photography"
    }
  };

  const p = profiles[profile] || profiles.leudy;

  return `Você é especialista em marketing digital criando conteúdo para ${p.name}.

PERFIL: ${p.desc}
TOM DE VOZ: ${p.tom}
CORES DA MARCA: ${p.cores}
SÍMBOLO: ${p.simbolo}
HASHTAGS BASE: ${p.hashtags}
ESTILO DE IMAGEM: ${p.estilo_img}

INSTRUÇÕES IMPORTANTES:
- Responda APENAS com JSON puro e válido
- Sem markdown, sem backticks, sem explicações
- Gere exatamente 3 versões diferentes
- Cada versão deve ser criativa e distinta das outras

JSON obrigatório (copie este formato exato):
{"versoes":[{"legenda":"legenda completa aqui com emojis e CTA","imgEn":"detailed English image prompt","imgPt":"prompt de imagem em português","hashtags":["#tag1","#tag2","#tag3"],"roteiro":"roteiro de reels aqui"},{"legenda":"segunda versão","imgEn":"second prompt","imgPt":"segundo prompt","hashtags":["#tag1"],"roteiro":"segundo roteiro"},{"legenda":"terceira versão","imgEn":"third prompt","imgPt":"terceiro prompt","hashtags":["#tag1"],"roteiro":"terceiro roteiro"}]}`;
}
