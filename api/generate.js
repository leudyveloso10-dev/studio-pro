import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });
  try {
    const { prompt, profile } = req.body;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const fullPrompt = buildSystemPrompt(profile) + '\n\n' + prompt;
    const result = await model.generateContent(fullPrompt);
    const text = result.response.text();
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try { return res.status(200).json(JSON.parse(clean)); }
    catch { return res.status(200).json({ raw: text }); }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function buildSystemPrompt(profile) {
  const profiles = {
    annes: { name:"Anne's Confeitaria", desc:"Confeitaria artesanal — bolos personalizados, doces finos, salgados, kits festas e corporativos.", tom:"descontraído, acolhedor, elegante e vendedor", cores:"amarelo #F7C948, verde tiffany #3DBFA8, navy #1B2E4B", hashtags:"#confeitaria #annesconfeitaria #bolopersonalizado #docesartesanais #salgados #kitsfesta #encomendas", estilo_img:"warm pastel food photography, yellow and tiffany green tones, artisan bakery, bee crown motif" },
    ftec: { name:"FreedomTec Engenharia", desc:"Engenharia e Serviços Técnicos — reformas de componentes, limpeza dielétrica, faróis Altezza e Berg Steel. Clientes: mineração.", tom:"técnico, profissional, didático e direto", cores:"navy #0d1f2d, dourado #c9a84c, prata #c0c0c0", hashtags:"#freedomtec #engenharia #mineracao #reformadecomponentes #limpezadieletrica #altezza #bergsteel", estilo_img:"industrial technical photography, dark navy and gold tones, precision machinery, mining industry" },
    leudy: { name:"Leudy Veloso", desc:"Marketing e Inovação com IA — tecnologia, gastronomia, lifestyle, ensaios pessoais.", tom:"leve, reflexivo, dinâmico e moderno", cores:"bordô #8b0000, dourado #c9a84c, preto #1a1a1a", hashtags:"#leudyveloso #marketingdigital #inteligenciaartificial #gastronomia #lifestyle #inovacao", estilo_img:"editorial portrait, deep red and gold tones, hummingbird motif, split-face tech concept" }
  };
  const p = profiles[profile] || profiles.leudy;
  return `Você é especialista em marketing digital criando conteúdo para ${p.name}.
PERFIL: ${p.desc}
TOM: ${p.tom}
CORES: ${p.cores}
HASHTAGS BASE: ${p.hashtags}
ESTILO IMAGEM: ${p.estilo_img}

Responda APENAS com JSON puro e válido, sem markdown, sem explicações.
Gere exatamente 3 versões diferentes e criativas.
Formato obrigatório:
{"versoes":[{"legenda":"legenda completa com emojis e CTA (min 120 palavras)","imgEn":"detailed English image prompt","imgPt":"prompt em português","hashtags":["#tag1","#tag2"],"roteiro":"roteiro 30s para Reels com cenas numeradas"},{"legenda":"...","imgEn":"...","imgPt":"...","hashtags":["#tag1"],"roteiro":"..."},{"legenda":"...","imgEn":"...","imgPt":"...","hashtags":["#tag1"],"roteiro":"..."}]}`;
}
