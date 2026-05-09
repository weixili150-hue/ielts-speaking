const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3457;

const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_BASE = "https://api.deepseek.com/v1";
const MODEL = "deepseek-chat";

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ── Examiner persona (shared) ──
const EXAMINER_PERSONA = `You are James Mitchell, a British IELTS examiner with 15 years of experience. You've examined candidates in London, Sydney, and Tokyo. Your manner is professional yet warm — like a strict teacher who genuinely wants the student to improve. You point out mistakes gently but accurately. You always demonstrate correct, natural British English expressions.

Key traits:
- Use simple, idiomatic British English (not textbook English)
- Correct grammar and word choice errors when you hear them, but don't be pedantic
- Encourage the candidate naturally — "That's a good point", "I see what you mean"
- Ask follow-up questions to dig deeper, like a real examiner
- Keep responses concise — 2-4 sentences max, then a question
- Never break character`;

// ── Chat API ──
app.post("/api/chat", async (req, res) => {
  const { mode, topic, message, history } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: "empty message" });

  let modePrompt = "";
  if (mode === "free-talk") {
    modePrompt = "This is a free conversation practice. Chat naturally about any topic the candidate brings up. Be curious and ask follow-up questions.";
  } else if (mode === "ielts-topics") {
    modePrompt = `This is an IELTS topic-focused practice. The topic is: "${topic || 'general'}". Ask 2-3 questions about this topic, then move to related subtopics.`;
  } else if (mode === "mock-test") {
    modePrompt = `This is a full IELTS mock test. Follow the official IELTS Speaking test structure:
Part 1 (4-5 min): Introduce yourself, ask about familiar topics (home, work, studies, hobbies).
Part 2 (2 min): Give the candidate a topic card, 1 min to prepare, then they speak for 1-2 min.
Part 3 (4-5 min): Ask deeper, more abstract questions related to the Part 2 topic.
Start with Part 1. Announce each part transition. At the end of Part 3, say "That concludes the speaking test. Thank you."`;
  }

  const systemPrompt = `${EXAMINER_PERSONA}\n\n${modePrompt}\n\nIMPORTANT: In your response, after your spoken reply, include a separate CORRECTION section (marked with [CORRECTION]) where you identify any grammar or word choice errors the candidate made and provide the natural British expression. Format:

[CORRECTION]
- Error: "..."
- Should be: "..."
- More natural: "..."`;

  try {
    const body = {
      model: MODEL,
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        ...(history || []).map(m => ({ role: m.speaker === "examiner" ? "assistant" : "user", content: m.text })),
        { role: "user", content: message.trim() }
      ]
    };

    if (MODEL === "deepseek-chat") {
      body.thinking = { type: "enabled" };
      body.output_config = { effort: "max" };
    }

    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`${resp.status} ${JSON.stringify(data).slice(0, 200)}`);

    const fullReply = data.choices[0].message.content.trim();
    // Split examiner reply from correction
    const parts = fullReply.split("[CORRECTION]");
    const reply = parts[0].trim();
    const correction = parts[1] ? parts[1].trim() : "";

    res.json({ reply, correction });
  } catch (e) {
    console.error("Chat error:", e.message);
    res.status(500).json({ error: "Sorry, something went wrong. Please try again." });
  }
});

// ── Evaluate API ──
app.post("/api/evaluate", async (req, res) => {
  const { mode, transcript } = req.body || {};
  if (!transcript || !transcript.length) return res.status(400).json({ error: "empty transcript" });

  const conversation = transcript.map(t => `${t.speaker.toUpperCase()}: ${t.text}`).join("\n\n");

  const systemPrompt = `${EXAMINER_PERSONA}

You just finished a speaking session with this candidate. Now provide a comprehensive evaluation.

Return ONLY valid JSON, no markdown, no other text:
{
  "scores": { "fluency": 6.5, "vocabulary": 6.0, "grammar": 6.5, "pronunciation": 7.0 },
  "summary": "Overall, your performance was... (2-3 sentences, encouraging but honest)",
  "corrections": [
    { "original": "I study computer", "corrected": "I'm studying computer science", "natural": "I'm studying computer science at university", "explanation": "'Computer' by itself sounds incomplete in English" }
  ],
  "naturalExpressions": [
    "I'm currently in my second year.",
    "It's quite a demanding course."
  ],
  "recommendations": [
    "Work on article usage (a/an/the)",
    "Practice present perfect for experiences"
  ],
  "nextTopics": ["Technology", "Education"],
  "transcriptWithChinese": [
    { "speaker": "examiner", "english": "What do you study?", "chinese": "你学什么？" },
    { "speaker": "user", "english": "I study computer science.", "chinese": "我学计算机科学。" }
  ]
}

Scores must be realistic (1-9 range, 0.5 increments). Corrections array: only include actual mistakes — if the candidate said something correctly, don't fabricate issues. naturalExpressions: 3-5 useful phrases the candidate should learn from this conversation. transcriptWithChinese: translate EVERY exchange from the conversation into colloquial Chinese — each entry must have speaker ("examiner" or "user"), "english" (original text), and "chinese" (natural Chinese translation). Provide translations for ALL messages in the transcript.`;

  try {
    const body = {
      model: MODEL,
      max_tokens: 4000,
      temperature: 0.5,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Please evaluate this speaking session:\n\n${conversation}` }
      ]
    };

    if (MODEL === "deepseek-chat") {
      body.thinking = { type: "enabled" };
      body.output_config = { effort: "max" };
    }

    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(`${resp.status} ${JSON.stringify(data).slice(0, 200)}`);

    const content = data.choices[0].message.content.trim();
    const jsonStr = content.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    const result = JSON.parse(jsonStr);
    res.json(result);
  } catch (e) {
    console.error("Evaluate error:", e.message);
    res.status(500).json({ error: "Evaluation failed. Please try again." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`IELTS Speaking Coach → http://localhost:${PORT}`);
});
