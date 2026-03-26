const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");
const {
  getDefaultBankAccount,
  upsertDefaultBankAccount,
} = require("../controllers/bankAccounts.controller");

router.use(verifyToken);

router.get("/default", getDefaultBankAccount);
router.put("/default", upsertDefaultBankAccount);

module.exports = router;