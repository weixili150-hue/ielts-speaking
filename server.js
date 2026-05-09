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
- Never break character
- The candidate uses speech recognition. When their message contains obvious transcription errors (wrong words that sound similar, garbled phrases), interpret what they likely intended based on context. Respond to the intended meaning, not the literal error. Do NOT explicitly mention 'speech recognition' or 'transcription error' in your response — just understand and reply naturally.`;

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
  "summary": "Overall, your performance was... (2-3 sentences in English, REQUIRED)",
	  "summaryChinese": "总体来说，你的表现... (2-3句中文总结，REQUIRED, must NOT be empty)",
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
    {
      "speaker": "user",
      "english": "I study computer science.",
      "chinese": "我学计算机科学。",
      "correction": { "original": "I study computer", "corrected": "I'm studying computer science", "natural": "I'm studying computer science at university", "explanation": "用现在进行时更自然" },
      "naturalExpressions": ["I'm a computer science student.", "I'm currently in my second year of CS."],
      "suggestion": "尝试使用现在进行时来描述正在进行的学业"
    }
  ]
}

	IMPORTANT: The candidate used speech recognition, so some of their transcribed sentences may contain recognition errors (similar-sounding wrong words). When evaluating, judge the INTENDED meaning, not literal transcription errors. Do NOT penalize for obvious STT errors.

Scores must be realistic (1-9 range, 0.5 increments).

	CRITICAL: transcriptWithChinese is the MOST IMPORTANT field. You MUST include EVERY single exchange from the conversation — every examiner question and every user answer. Do NOT skip any turns, do NOT summarize. Each exchange = one entry in the array. The array length MUST match the full conversation.

	For each examiner entry: include speaker/english/chinese only.
	For each USER entry, you MUST include ALL of the following:
	- "correction": if there's any grammar/vocabulary/word-choice issue, provide { original, corrected, natural, explanation } using the exact words the user said. If the sentence is perfect, set to null.
	- "naturalExpressions": 1-3 better/more idiomatic ways to express what the user said. ALWAYS include this, even if correction is null.
	- "suggestion": one short, actionable improvement tip in Chinese (e.g. "尝试用...代替..."). ALWAYS include this.

	The top-level "corrections" and "naturalExpressions" arrays should summarize the most important ones across all sentences. "summary" MUST be in English. CRITICAL: "summaryChinese" MUST be a natural Chinese translation of the summary — NEVER omit this field, NEVER leave it empty.`;

  try {
    const body = {
      model: MODEL,
      max_tokens: 12000,
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
    console.log("Evaluate response length:", content.length, "chars");
    const jsonStr = content.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    const result = JSON.parse(jsonStr);
    const tcwLen = (result.transcriptWithChinese && result.transcriptWithChinese.length) || 0;
    console.log("transcriptWithChinese entries:", tcwLen, "| transcript sent:", transcript.length);

    // Always translate summary to Chinese for reliability
    if (result.summary) {
      console.log("Translating summary to Chinese...");
      try {
        const tBody = {
          model: MODEL,
          max_tokens: 500,
          temperature: 0.3,
          messages: [
            { role: "system", content: "Translate the following English text into natural Chinese. Return ONLY the Chinese translation, nothing else." },
            { role: "user", content: result.summary }
          ]
        };
        const tResp = await fetch(API_BASE + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + API_KEY },
          body: JSON.stringify(tBody)
        });
        const tData = await tResp.json();
        if (tResp.ok) {
          result.summaryChinese = tData.choices[0].message.content.trim();
          console.log("summaryChinese:", result.summaryChinese.substring(0, 60));
        }
      } catch (te) {
        console.error("Translation failed:", te.message);
      }
    }

    res.json(result);
  } catch (e) {
    console.error("Evaluate error:", e.message);
    console.error("Raw content (first 300):", (content || "").substring(0, 300));
    res.status(500).json({ error: "Evaluation failed. Please try again." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`IELTS Speaking Coach → http://localhost:${PORT}`);
});
