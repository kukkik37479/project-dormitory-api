const {
  getDefaultBankAccountByOwnerId,
  upsertDefaultBankAccountByOwnerId,
} = require("../services/bankAccounts.service");

function ensureOwner(req, res) {
  if (!req.user || req.user.role !== "owner") {
    res.status(403).json({
      message: "Only owner can access bank accounts API",
    });
    return false;
  }

  return true;
}

async function getDefaultBankAccount(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const bankAccount = await getDefaultBankAccountByOwnerId(
      req.user.userId,
      req.user.dormId
    );

    return res.json({
      message: "Default bank account fetched successfully",
      bank_account: bankAccount,
    });
  } catch (error) {
    console.error("getDefaultBankAccount error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function upsertDefaultBankAccount(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const bankAccount = await upsertDefaultBankAccountByOwnerId(
      req.user.userId,
      req.user.dormId,
      req.body
    );

    return res.json({
      message: "Default bank account saved successfully",
      bank_account: bankAccount,
    });
  } catch (error) {
    console.error("upsertDefaultBankAccount error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

module.exports = {
  getDefaultBankAccount,
  upsertDefaultBankAccount,
};