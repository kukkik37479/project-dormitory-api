const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadDir = path.join(__dirname, "../../uploads/contracts");
fs.mkdirSync(uploadDir, { recursive: true });

function decodeThaiFileName(name = "") {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

function sanitizeFileName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9ก-๙._-]/g, "");
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const decodedOriginalName = decodeThaiFileName(file.originalname || "contract");
    const ext = path.extname(decodedOriginalName).toLowerCase();
    const baseName = path.basename(decodedOriginalName, ext);
    const safeBaseName = sanitizeFileName(baseName) || "contract";

    cb(null, `${Date.now()}-${safeBaseName}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowedMimeTypes = ["application/pdf"];
  const decodedOriginalName = decodeThaiFileName(file.originalname || "");
  const ext = path.extname(decodedOriginalName).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) && ext === ".pdf") {
    return cb(null, true);
  }

  return cb(new Error("อนุญาตเฉพาะไฟล์ PDF เท่านั้น"));
}

const contractUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

module.exports = contractUpload;