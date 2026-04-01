export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const geminiKey = process.env.GEMINI_API_KEY;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const cloudKey = process.env.CLOUDINARY_API_KEY;
  const cloudSecret = process.env.CLOUDINARY_API_SECRET;

  if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY não configurada.' });

  try {
    const { prompt, profile, images } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt obrigatório.' });

    let imageUrls = [];
    if (images && images.length > 0 && cloudName && cloudKey && cloudSecret) {
      for (const img of images) {
        if (!img || !img.data) continue;
        try {
          const url = await uploadToCloudinary(img, cloudName, cloudKey, cloudSecret);
          if (url) imageUrls.push(url);
        } catch(e) { console.error('Cloudinary error:', e.message); }
      }
    }

    const parts = [{ text: buildSystemPrompt(profile) + '\n\n' + prompt }];
    if (imageUrls.length > 0) {
      parts.push({ text: '\nAnalise as imagens e use os elementos visuais REAIS para criar os prompts.' });
      for (const url of imageUrls) {
        parts.push({ file_data: { file_uri: url, mime_type: 'image/jpeg' } });
      }
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.8, maxOutputTokens: 2048 } }) }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Erro Gemini' });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  // Try again with stricter prompt
  return res.status(200).json({ error: 'Resposta sem JSON: ' + text.substring(0, 150) });
}

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return res.status(200).json({ versoes: parsed.versoes || parsed.versões || [] });
    } catch(e) {
      return res.status(200).json({ error: 'Erro ao processar. Tente novamente.' });
    }
  } catch (err) { return res.status(500).json({ error: err.message }); }
}

async function uploadToCloudinary(img, cloudName, apiKey, apiSecret) {
  const timestamp = Math.round(Date.now() / 1000);
  const str = `folder=studio-pro&timestamp=${timestamp}${apiSecret}`;
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const signature = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');

  const formData = new URLSearchParams();
  formData.append('file', `data:${img.mimeType};base64,${img.data}`);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);
  formData.append('folder', 'studio-pro');

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: formData });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Cloudinary error');
  return result.secure_url;
}

function buildSystemPrompt(profile) {
  const profiles = {
    annes: { name:"Anne's Confeitaria", desc:"Confeitaria artesanal — bolos personalizados, doces finos, salgados, kits festas e corporativos.", tom:"descontraído, acolhedor, elegante e vendedor", cores:"amarelo #F7C948, verde tiffany #3DBFA8, navy #1B2E4B", simbolo:"abelha com coroa", hashtags:"#confeitaria #annesconfeitaria #bolopersonalizado #docesartesanais #salgados #kitsfesta #encomendas" },
    ftec: { name:"FreedomTec Engenharia", desc:"Engenharia e Serviços Técnicos para mineração — reformas de componentes, limpeza dielétrica, faróis Altezza e Berg Steel.", tom:"técnico, profissional, didático e direto", cores:"navy #0d1f2d, dourado #c9a84c, prata #c0c0c0", simbolo:"velas náuticas douradas", hashtags:"#freedomtec #engenharia #mineracao #reformadecomponentes #limpezadieletrica #altezza #bergsteel" },
    leudy: { name:"Leudy Veloso", desc:"Marketing e Inovação com IA — tecnologia, gastronomia, lifestyle, ensaios pessoais.", tom:"leve, reflexivo, dinâmico e moderno", cores:"bordô #8b0000, dourado #c9a84c, preto #1a1a1a", simbolo:"beija-flor dourado", hashtags:"#leudyveloso #marketingdigital #inteligenciaartificial #gastronomia #lifestyle #inovacao" }
  };
  const p = profiles[profile] || profiles.leudy;
  return `Você é especialista em marketing digital criando conteúdo para ${p.name}.
PERFIL: ${p.desc}
TOM: ${p.tom}
CORES: ${p.cores}
SÍMBOLO: ${p.simbolo}
HASHTAGS BASE: ${p.hashtags}

Responda APENAS com JSON puro válido, sem markdown.
Se houver imagens de referência, analise e descreva os elementos REAIS nos prompts.

{"versoes":[{"legenda":"legenda completa com emojis e CTA (min 120 palavras)","imgEn":"detailed English image prompt","imgPt":"prompt detalhado em português","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"roteiro 30s Reels com cenas numeradas"},{"legenda":"segunda versão","imgEn":"...","imgPt":"...","hashtags":["#tag1"],"roteiro":"..."},{"legenda":"terceira versão","imgEn":"...","imgPt":"...","hashtags":["#tag1"],"roteiro":"..."}]}`;
}
