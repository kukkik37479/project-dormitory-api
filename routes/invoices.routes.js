const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");

// เดี๋ยว controller เราจะสร้างในขั้นถัดไป
const {
  getInvoiceFormOptions,
  createInvoice,
  getInvoices,
  getInvoiceDetail,
} = require("../controllers/invoices.controller");

router.use(verifyToken);

router.get("/form-options", getInvoiceFormOptions);
router.post("/", createInvoice);
router.get("/", getInvoices);
router.get("/:invoiceId", getInvoiceDetail);

module.exports = router;