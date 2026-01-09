import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch";

const __dirname = path.resolve();
const app = express();

app.use(cors({ origin: true }));
app.use(express.static(__dirname));

const upload = multer({ dest: "chunks/" });
const ttsDir = path.join(__dirname, "tts");
if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir);

let ttsCounter = 0;

async function whisperTranslate(buffer, filename) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const fd = new FormData();
  fd.append("model", "whisper-1");
  fd.append("response_format", "text");
  fd.append("file", buffer, { filename });

  const res = await fetch("https://api.openai.com/v1/audio/translations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd
  });

  const txt = await res.text();
  if (!res.ok) throw new Error("Whisper error " + res.status + ": " + txt);
  return txt.trim();
}

async function synthesizeTTS(text) {
  const fname = `tts_${Date.now()}_${ttsCounter++}.wav`;
  const fpath = path.join(ttsDir, fname);

  const sampleRate = 8000;
  const seconds = 1;
  const numSamples = sampleRate * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + numSamples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(numSamples * 2, 40);
  const data = Buffer.alloc(numSamples * 2);
  const wav = Buffer.concat([header, data]);
  fs.writeFileSync(fpath, wav);

  return "/tts/" + fname;
}

app.use("/tts", express.static(ttsDir));

app.post("/api/chunk", upload.single("chunk"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No chunk file" });

    const filePath = req.file.path;
    const buffer = fs.readFileSync(filePath);

    let text = "";
    try {
      text = await whisperTranslate(buffer, req.file.originalname || "chunk.webm");
    } finally {
      fs.unlink(filePath, () => {});
    }

    let audioUrl = "";
    if (text) audioUrl = await synthesizeTTS(text);

    return res.json({ text, audioUrl });
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
});

app.listen(3000, () => {
  console.log("Open: http://localhost:3000");
});
