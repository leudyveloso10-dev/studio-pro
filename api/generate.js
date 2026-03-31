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
    const systemPrompt = buildSystemPrompt(profile);
    const result = await model.generateContent(systemPrompt + '\n\n' + prompt);
    const text = result.response.text();
    const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
      return res.status(200).json(JSON.parse(clean));
    } catch {
      return res.status(200).json({ raw: text });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
