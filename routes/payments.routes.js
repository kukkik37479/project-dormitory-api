const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");

const {
  getTenantBillingOverview,
  submitTenantPayment,
  getOwnerPayments,
  getOwnerPaymentDetail,
  approveOwnerPayment,
  rejectOwnerPayment,
} = require("../controllers/payments.controller");

router.use(verifyToken);

/* =========================
   Tenant
   ========================= */

// ดูบิลปัจจุบัน + ประวัติการชำระเงินของผู้เช่า
router.get("/tenant/overview", getTenantBillingOverview);

// ส่งหลักฐานการชำระเงิน
router.post("/tenant/submit", submitTenantPayment);

/* =========================
   Owner
   ========================= */

// รายการการชำระเงินฝั่งเจ้าของหอ
router.get("/", getOwnerPayments);

// ดูรายละเอียด/หลักฐานการโอน
router.get("/:paymentId", getOwnerPaymentDetail);

// ยืนยันการตรวจสอบ
router.patch("/:paymentId/approve", approveOwnerPayment);

// ตีกลับการชำระเงิน
router.patch("/:paymentId/reject", rejectOwnerPayment);

module.exports = router;