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

    // PASSO 1: Se tem imagens, descreve rapidamente
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

    // PASSO 2: Gera conteúdo — chamada única, sem retry (evita timeout Vercel free)
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
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 3000,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      const errData = await response.json();
      return res.status(response.status).json({ error: errData.error?.message || 'Erro Gemini' });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!rawText) {
      return res.status(200).json({ error: 'Resposta vazia do modelo. Tente novamente.' });
    }

    const parsed = extractJSON(rawText);
    if (!parsed) {
      // Devolve os primeiros 300 chars da resposta para diagnóstico
      return res.status(200).json({
        error: 'Erro ao processar resposta. Tente novamente.',
        _raw: rawText.substring(0, 300)
      });
    }

    const versoes = parsed.versoes || parsed.versões || [];
    if (versoes.length === 0) {
      return res.status(200).json({ error: 'Nenhuma versão gerada. Tente novamente.' });
    }

    return res.status(200).json({ versoes });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Extrai JSON com 4 estratégias progressivas ──
function extractJSON(text) {
  const clean = text.trim();

  // 1. Bloco ```json ... ```
  const mdMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) {
    const r = tryParse(mdMatch[1].trim());
    if (r) return r;
  }

  // 2. Primeiro objeto { } balanceado
  const balanced = findBalancedJSON(clean);
  if (balanced) {
    const r = tryParse(balanced);
    if (r) return r;
  }

  // 3. Texto inteiro
  const r3 = tryParse(clean);
  if (r3) return r3;

  // 4. Reparar e tentar novamente
  if (balanced) {
    const r4 = tryParse(repairJSON(balanced));
    if (r4) return r4;
  }

  return null;
}

function tryParse(str) {
  try {
    const p = JSON.parse(str);
    if (typeof p === 'object' && p !== null) return p;
  } catch(e) {}
  return null;
}

function findBalancedJSON(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function repairJSON(str) {
  return str
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/(['"])?([a-zA-Z_][a-zA-Z0-9_]*)(['"])?\s*:/g, '"$2":')
    .replace(/:\s*'([^']*?)'/g, ': "$1"')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .trim();
}

function buildSystemPrompt(profile) {
  const profiles = {
    annes: {
      name: "Anne's Confeitaria",
      desc: "Confeitaria artesanal — bolos personalizados, doces finos, salgados, kits festas e corporativos.",
      tom: "descontraído, acolhedor, elegante e vendedor",
      cores: "âmbar #F5A623, laranja-mel #E8763A, dourado claro #FFC95C",
      simbolo: "abelha com coroa",
      hashtags: "#confeitaria #annesconfeitaria #bolopersonalizado #docesartesanais #salgados #kitsfesta #encomendas #doceria"
    },
    ftec: {
      name: "FreedomTec Engenharia",
      desc: "Engenharia e Serviços Técnicos para mineração — reformas de componentes, limpeza dielétrica, faróis Altezza e Berg Steel.",
      tom: "técnico, profissional, didático e direto",
      cores: "ouro #C9A84C, navy #0D2137, aço #8BA7C0",
      simbolo: "velas náuticas douradas",
      hashtags: "#freedomtec #engenharia #mineracao #reformadecomponentes #limpezadieletrica #altezza #bergsteel #industria"
    },
    leudy: {
      name: "Leudy Veloso",
      desc: "Marketing e Inovação com IA — tecnologia, gastronomia, lifestyle, ensaios pessoais.",
      tom: "leve, reflexivo, dinâmico e moderno",
      cores: "vermelho #C8102E, bordô #7B0018, dourado #C9A84C",
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

REGRAS CRÍTICAS:
- Responda APENAS com JSON puro e válido, sem markdown, sem texto antes ou depois
- Use aspas duplas em tudo, nunca aspas simples
- Não deixe vírgulas no final de objetos ou arrays
- Feche TODAS as chaves e colchetes corretamente

FORMATO EXATO (2 versões):
{"versoes":[{"legenda":"legenda completa com emojis e CTA (min 100 palavras)","imgEn":"detailed English image prompt for AI generation","imgPt":"prompt detalhado em português para geração de imagem","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"roteiro 30s Reels com cenas numeradas"},{"legenda":"segunda versão diferente da primeira","imgEn":"...","imgPt":"...","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"..."}]}`;
}
