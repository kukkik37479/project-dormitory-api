const {
  getTenantBillingOverviewByUserId,
  createTenantPaymentSubmission,
  listOwnerPayments,
  getOwnerPaymentDetailByOwnerId,
  approvePaymentByOwnerId,
  rejectPaymentByOwnerId,
} = require("../services/payments.service");

function ensureAuthenticated(req, res) {
  if (!req.user || !req.user.userId) {
    res.status(401).json({ message: "กรุณาเข้าสู่ระบบ" });
    return false;
  }
  return true;
}

function ensureTenant(req, res) {
  if (!ensureAuthenticated(req, res)) return false;

  if (req.user.role !== "tenant") {
    res.status(403).json({ message: "ไม่มีสิทธิ์ใช้งานส่วนนี้" });
    return false;
  }

  return true;
}

function ensureOwner(req, res) {
  if (!ensureAuthenticated(req, res)) return false;

  if (req.user.role !== "owner") {
    res.status(403).json({ message: "ไม่มีสิทธิ์ใช้งานส่วนนี้" });
    return false;
  }

  if (!req.user.dormId) {
    res.status(401).json({ message: "ไม่พบข้อมูลหอพักของผู้ใช้งาน" });
    return false;
  }

  return true;
}

/* =========================
   Tenant
   ========================= */

async function getTenantBillingOverview(req, res) {
  try {
    if (!ensureTenant(req, res)) return;

    const result = await getTenantBillingOverviewByUserId({
      userId: req.user.userId,
    });

    return res.status(200).json({
      message: "โหลดข้อมูลบิลและการชำระเงินสำเร็จ",
      ...result,
    });
  } catch (error) {
    console.error("getTenantBillingOverview error:", error);
    return res.status(500).json({
      message: "โหลดข้อมูลบิลและการชำระเงินไม่สำเร็จ",
    });
  }
}

async function submitTenantPayment(req, res) {
  try {
    if (!ensureTenant(req, res)) return;

    const {
      invoice_id,
      submitted_amount,
      slip_image_url,
      reference_no,
      paid_at,
      payment_method,
    } = req.body || {};

    if (!invoice_id) {
      return res.status(400).json({ message: "กรุณาระบุ invoice_id" });
    }

    if (!submitted_amount || Number(submitted_amount) <= 0) {
      return res.status(400).json({ message: "จำนวนเงินที่ชำระไม่ถูกต้อง" });
    }

    if (!slip_image_url || String(slip_image_url).trim() === "") {
      return res.status(400).json({ message: "กรุณาแนบหลักฐานการโอน" });
    }

    const result = await createTenantPaymentSubmission({
      userId: req.user.userId,
      invoiceId: invoice_id,
      submittedAmount: Number(submitted_amount),
      slipImageUrl: String(slip_image_url).trim(),
      referenceNo:
        reference_no && String(reference_no).trim() !== ""
          ? String(reference_no).trim()
          : null,
      paidAt: paid_at || null,
      paymentMethod: payment_method || "transfer",
    });

    if (!result) {
      return res.status(404).json({ message: "ไม่พบบิลที่ต้องการชำระ" });
    }

    return res.status(201).json({
      message: "ส่งหลักฐานการชำระเงินเรียบร้อยแล้ว",
      payment: result,
    });
  } catch (error) {
    console.error("submitTenantPayment error:", error);

    if (error.message === "INVOICE_NOT_FOUND") {
      return res.status(404).json({ message: "ไม่พบบิลที่ต้องการชำระ" });
    }

    if (error.message === "INVOICE_NOT_BELONG_TO_TENANT") {
      return res.status(403).json({ message: "บิลนี้ไม่ใช่ของผู้ใช้งาน" });
    }

    if (error.message === "INVOICE_NOT_PAYABLE") {
      return res.status(400).json({ message: "บิลนี้ยังไม่สามารถชำระได้" });
    }

    return res.status(500).json({ message: "ส่งหลักฐานการชำระเงินไม่สำเร็จ" });
  }
}

/* =========================
   Owner
   ========================= */

async function getOwnerPayments(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const result = await listOwnerPayments({
      ownerUserId: req.user.userId,
      dormId: req.user.dormId,
      query: req.query || {},
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("getOwnerPayments error:", error);
    return res.status(500).json({ message: "โหลดรายการการชำระเงินไม่สำเร็จ" });
  }
}

async function getOwnerPaymentDetail(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const { paymentId } = req.params;

    const result = await getOwnerPaymentDetailByOwnerId({
      ownerUserId: req.user.userId,
      dormId: req.user.dormId,
      paymentId,
    });

    if (!result) {
      return res.status(404).json({ message: "ไม่พบรายการชำระเงินนี้" });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("getOwnerPaymentDetail error:", error);
    return res.status(500).json({ message: "โหลดรายละเอียดการชำระเงินไม่สำเร็จ" });
  }
}

async function approveOwnerPayment(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const { paymentId } = req.params;
    const { reviewNote } = req.body || {};

    const result = await approvePaymentByOwnerId({
      ownerUserId: req.user.userId,
      dormId: req.user.dormId,
      paymentId,
      reviewNote:
        reviewNote && String(reviewNote).trim() !== ""
          ? String(reviewNote).trim()
          : null,
    });

    if (!result) {
      return res.status(404).json({ message: "ไม่พบรายการชำระเงินนี้" });
    }

    return res.status(200).json({
      message: "ยืนยันการตรวจสอบเรียบร้อยแล้ว",
      data: result,
    });
  } catch (error) {
    console.error("approveOwnerPayment error:", error);
    return res.status(500).json({ message: "ยืนยันการตรวจสอบไม่สำเร็จ" });
  }
}

async function rejectOwnerPayment(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const { paymentId } = req.params;
    const { reviewNote } = req.body || {};

    if (!reviewNote || String(reviewNote).trim() === "") {
      return res.status(400).json({ message: "กรุณาระบุเหตุผลในการตีกลับ" });
    }

    const result = await rejectPaymentByOwnerId({
      ownerUserId: req.user.userId,
      dormId: req.user.dormId,
      paymentId,
      reviewNote: String(reviewNote).trim(),
    });

    if (!result) {
      return res.status(404).json({ message: "ไม่พบรายการชำระเงินนี้" });
    }

    return res.status(200).json({
      message: "ตีกลับรายการชำระเงินเรียบร้อยแล้ว",
      data: result,
    });
  } catch (error) {
    console.error("rejectOwnerPayment error:", error);
    return res.status(500).json({ message: "ตีกลับรายการชำระเงินไม่สำเร็จ" });
  }
}

module.exports = {
  getTenantBillingOverview,
  submitTenantPayment,
  getOwnerPayments,
  getOwnerPaymentDetail,
  approveOwnerPayment,
  rejectOwnerPayment,
};