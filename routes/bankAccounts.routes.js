const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");
const { paymentQrUpload } = require("../middleware/paymentQrUpload.middleware");
const {
  getDefaultBankAccount,
  upsertDefaultBankAccount,
} = require("../controllers/bankAccounts.controller");

router.use(verifyToken);

router.get("/default", getDefaultBankAccount);
router.put(
  "/default",
  paymentQrUpload.single("qr_image"),
  upsertDefaultBankAccount
);

module.exports = router;