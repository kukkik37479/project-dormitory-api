const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");
const contractUpload = require("../middleware/upload.middleware");
const {
  endContract,
  updateContractFile,
} = require("../controllers/tenant.controller");

router.patch("/:contractId/end", verifyToken, endContract);
router.patch(
  "/:contractId/file",
  verifyToken,
  contractUpload.single("contract_file"),
  updateContractFile
);

module.exports = router;