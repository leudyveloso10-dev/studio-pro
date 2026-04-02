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

    // PASSO 2: Gera conteúdo com retry automático
    const systemPrompt = buildSystemPrompt(profile);
    const fullPrompt = systemPrompt + '\n\n' + prompt +
      (imageDescription ? '\n\nDESCRIÇÃO DAS FOTOS DE REFERÊNCIA ENVIADAS:\n' + imageDescription + '\n\nUse esta descrição para criar prompts de imagem FIÉIS ao que foi descrito acima.' : '');

    const MAX_ATTEMPTS = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }],
              generationConfig: {
                temperature: attempt === 1 ? 0.8 : 0.6, // reduz temperatura no retry
                maxOutputTokens: 4500
              }
            })
          }
        );

        if (!response.ok) {
          const errData = await response.json();
          lastError = errData.error?.message || `HTTP ${response.status}`;
          continue; // tenta de novo
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!rawText) {
          lastError = 'Resposta vazia do modelo.';
          continue;
        }

        // Tenta extrair e parsear o JSON com múltiplas estratégias
        const parsed = extractJSON(rawText);
        if (parsed) {
          const versoes = parsed.versoes || parsed.versões || [];
          if (versoes.length > 0) {
            return res.status(200).json({ versoes });
          }
          lastError = 'JSON válido mas sem versões. Tentando novamente...';
          continue;
        }

        lastError = 'Não foi possível extrair JSON da resposta.';
        // Se última tentativa, devolve o texto cru para debug
        if (attempt === MAX_ATTEMPTS) {
          return res.status(200).json({
            error: 'Erro ao processar resposta após ' + MAX_ATTEMPTS + ' tentativas. Tente novamente.',
            debug: rawText.substring(0, 200)
          });
        }

      } catch(err) {
        lastError = err.message;
        if (attempt === MAX_ATTEMPTS) throw err;
      }
    }

    return res.status(200).json({ error: lastError || 'Erro desconhecido. Tente novamente.' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Tenta extrair JSON válido do texto com múltiplas estratégias:
 * 1. Bloco ```json ... ```
 * 2. Primeiro { ... } no texto
 * 3. Texto inteiro limpo
 * 4. Reparo de JSON quebrado (vírgulas extras, aspas, etc.)
 */
function extractJSON(text) {
  // Remove espaços e quebras desnecessárias no início/fim
  const clean = text.trim();

  // Estratégia 1: bloco ```json ... ```
  const mdMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) {
    const result = tryParse(mdMatch[1].trim());
    if (result) return result;
  }

  // Estratégia 2: encontrar o primeiro { balanceado
  const jsonMatch = findBalancedJSON(clean);
  if (jsonMatch) {
    const result = tryParse(jsonMatch);
    if (result) return result;
  }

  // Estratégia 3: tentar parsear o texto inteiro
  const result3 = tryParse(clean);
  if (result3) return result3;

  // Estratégia 4: reparar JSON comum e tentar novamente
  if (jsonMatch) {
    const repaired = repairJSON(jsonMatch);
    const result4 = tryParse(repaired);
    if (result4) return result4;
  }

  return null;
}

function tryParse(str) {
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch(e) {}
  return null;
}

// Encontra o objeto JSON principal balanceando chaves
function findBalancedJSON(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Tenta reparar problemas comuns em JSON gerado por LLMs
function repairJSON(str) {
  return str
    .replace(/,\s*}/g, '}')           // vírgula antes de }
    .replace(/,\s*]/g, ']')           // vírgula antes de ]
    .replace(/(['"])?([a-zA-Z_][a-zA-Z0-9_]*)(['"])?\s*:/g, '"$2":') // chaves sem aspas
    .replace(/:\s*'([^']*?)'/g, ': "$1"')  // aspas simples em valores
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // caracteres de controle
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
- Não use aspas simples, use aspas duplas
- Não deixe vírgulas no final de objetos ou arrays
- Certifique-se de fechar TODAS as chaves e colchetes corretamente

FORMATO EXATO:
{"versoes":[{"legenda":"legenda completa com emojis e CTA (min 100 palavras)","imgEn":"detailed English image prompt for AI generation","imgPt":"prompt detalhado em português para geração de imagem","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"roteiro 30s Reels com cenas numeradas"},{"legenda":"segunda versão diferente da primeira","imgEn":"...","imgPt":"...","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"..."},{"legenda":"terceira versão diferente das anteriores","imgEn":"...","imgPt":"...","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"],"roteiro":"..."}]}`;
}
