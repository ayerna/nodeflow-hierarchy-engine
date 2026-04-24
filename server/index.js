const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const { analyzeHierarchy } = require("./logic");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Submitter Identity ────────────────────────────────────────────────────────
const SUBMITTER = {
  user_id             : "gladwinselwyn_24042004",
  email_id            : "gladwinselwyn.2022it@sece.ac.in",
  college_roll_number : "RA2211003011893",
};

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ── Routes ────────────────────────────────────────────────────────────────────
app.post("/bfhl", (req, res) => {
  const { data } = req.body ?? {};

  if (!Array.isArray(data)) {
    return res.status(400).json({
      error: "Payload must contain a 'data' array.",
    });
  }

  try {
    const result = analyzeHierarchy(data);
    return res.status(200).json({ ...SUBMITTER, ...result });
  } catch (ex) {
    console.error("[/bfhl] Processing error:", ex.message);
    return res.status(500).json({ error: "Unexpected server error." });
  }
});

app.get("/health", (_req, res) =>
  res.json({ status: "running", ts: new Date().toISOString() })
);

// ── Boot ──────────────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`NodeFlow API  →  http://localhost:${PORT}`);
  });
}

module.exports = app;
