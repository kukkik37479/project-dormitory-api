const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");
const {
  getOverview,
  getRevenueTrend,
  getPaymentStatus,
  getTenantMovement,
  getUtilityUsageTrend,
  getExpiringContracts,
  getInvoiceReport,
  getPaymentReport,
  getArrearsReport,
  getMonthlyRevenueSummaryReport,
} = require("../controllers/dashboard.controller");

router.get("/overview", verifyToken, getOverview);
router.get("/revenue-trend", verifyToken, getRevenueTrend);
router.get("/payment-status", verifyToken, getPaymentStatus);
router.get("/tenant-movement", verifyToken, getTenantMovement);
router.get("/utility-usage-trend", verifyToken, getUtilityUsageTrend);
router.get("/expiring-contracts", verifyToken, getExpiringContracts);

router.get("/reports/invoices", verifyToken, getInvoiceReport);
router.get("/reports/payments", verifyToken, getPaymentReport);
router.get("/reports/arrears", verifyToken, getArrearsReport);
router.get(
  "/reports/revenue-summary",
  verifyToken,
  getMonthlyRevenueSummaryReport
);

module.exports = router;