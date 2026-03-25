const fs = require("fs");
const path = require("path");
const multer = require("multer");

const baseUploadDir = path.join(__dirname, "../../uploads/payment-qr");
fs.mkdirSync(baseUploadDir, { recursive: true });

function decodeThaiFileName(name = "") {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

function sanitizeSegment(value = "") {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeFileName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9ก-๙._-]/g, "");
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dormId = req.user?.dormId;

    if (!dormId) {
      return cb(new Error("Dorm context is required"));
    }

    const dormDir = path.join(baseUploadDir, sanitizeSegment(dormId));
    fs.mkdirSync(dormDir, { recursive: true });
    cb(null, dormDir);
  },
  filename: (_req, file, cb) => {
    const decodedOriginalName = decodeThaiFileName(file.originalname || "qr");
    const ext = path.extname(decodedOriginalName).toLowerCase();
    const baseName = path.basename(decodedOriginalName, ext);
    const safeBaseName = sanitizeFileName(baseName) || "qr";

    cb(null, `${Date.now()}-${safeBaseName}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
  const decodedOriginalName = decodeThaiFileName(file.originalname || "");
  const ext = path.extname(decodedOriginalName).toLowerCase();
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp"];

  if (allowedMimeTypes.includes(file.mimetype) && allowedExts.includes(ext)) {
    return cb(null, true);
  }

  return cb(new Error("อนุญาตเฉพาะไฟล์ JPG, PNG หรือ WEBP เท่านั้น"));
}

const paymentQrUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = {
  paymentQrUpload,
};