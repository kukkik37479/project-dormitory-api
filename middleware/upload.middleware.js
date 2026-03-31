const multer = require("multer");
const path = require("path");

function decodeThaiFileName(name = "") {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

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
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

module.exports = contractUpload;