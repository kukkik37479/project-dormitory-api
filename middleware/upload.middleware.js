const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadDir = path.join(__dirname, "../../uploads/contracts");
fs.mkdirSync(uploadDir, { recursive: true });

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
    const ext = path.extname(file.originalname || "").toLowerCase();
    const baseName = path.basename(file.originalname || "contract", ext);
    const safeBaseName = sanitizeFileName(baseName) || "contract";
    cb(null, `${Date.now()}-${safeBaseName}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/jpg",
  ];

  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("อนุญาตเฉพาะไฟล์ PDF, JPG, JPEG, PNG"));
  }

  cb(null, true);
}

const contractUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

module.exports = {
  contractUpload,
};