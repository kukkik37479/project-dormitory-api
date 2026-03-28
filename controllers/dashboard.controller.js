const dashboardService = require("../services/dashboard.service");

function getDormId(req) {
  return (
    req.user?.dormId ||
    req.user?.dorm_id ||
    req.query?.dormId ||
    req.params?.dormId ||
    null
  );
}

function getMonth(req) {
  const rawMonth = String(req.query?.month || "").trim();

  if (!rawMonth) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  const isValid = /^\d{4}-\d{2}$/.test(rawMonth);
  return isValid ? rawMonth : null;
}

function getPositiveInt(value, defaultValue, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) return defaultValue;
  if (parsed < min) return min;
  if (parsed > max) return max;

  return parsed;
}

function sendBadRequest(res, message) {
  return res.status(400).json({
    ok: false,
    message,
  });
}

async function getOverview(req, res) {
  try {
    const dormId = getDormId(req);
    const month = getMonth(req);

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    if (!month) {
      return sendBadRequest(res, "month ต้องอยู่ในรูปแบบ YYYY-MM");
    }

    const data = await dashboardService.getOverview({
      dormId,
      month,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getOverview error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงข้อมูลภาพรวมได้",
    });
  }
}

async function getRevenueTrend(req, res) {
  try {
    const dormId = getDormId(req);
    const months = getPositiveInt(req.query?.months, 6, { min: 1, max: 24 });

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    const data = await dashboardService.getRevenueTrend({
      dormId,
      months,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getRevenueTrend error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงข้อมูลแนวโน้มรายรับได้",
    });
  }
}

async function getPaymentStatus(req, res) {
  try {
    const dormId = getDormId(req);
    const month = getMonth(req);

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    if (!month) {
      return sendBadRequest(res, "month ต้องอยู่ในรูปแบบ YYYY-MM");
    }

    const data = await dashboardService.getPaymentStatus({
      dormId,
      month,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getPaymentStatus error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงข้อมูลสถานะการชำระเงินได้",
    });
  }
}

async function getTenantMovement(req, res) {
  try {
    const dormId = getDormId(req);
    const months = getPositiveInt(req.query?.months, 6, { min: 1, max: 24 });

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    const data = await dashboardService.getTenantMovement({
      dormId,
      months,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getTenantMovement error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงข้อมูลการย้ายเข้า-ย้ายออกได้",
    });
  }
}

async function getUtilityUsageTrend(req, res) {
  try {
    const dormId = getDormId(req);
    const months = getPositiveInt(req.query?.months, 6, { min: 1, max: 24 });

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    const data = await dashboardService.getUtilityUsageTrend({
      dormId,
      months,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getUtilityUsageTrend error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงข้อมูลแนวโน้มการใช้น้ำและไฟได้",
      detail: error?.message || String(error),
    });
  }
}

async function getExpiringContracts(req, res) {
  try {
    const dormId = getDormId(req);
    const days = getPositiveInt(req.query?.days, 30, { min: 1, max: 365 });

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    const data = await dashboardService.getExpiringContracts({
      dormId,
      days,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getExpiringContracts error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงข้อมูลสัญญาใกล้หมดได้",
    });
  }
}

async function getInvoiceReport(req, res) {
  try {
    const dormId = getDormId(req);
    const month = getMonth(req);
    const buildingId = req.query?.buildingId || null;
    const status = req.query?.status || null;

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    if (!month) {
      return sendBadRequest(res, "month ต้องอยู่ในรูปแบบ YYYY-MM");
    }

    const data = await dashboardService.getInvoiceReport({
      dormId,
      month,
      buildingId,
      status,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getInvoiceReport error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงรายงานใบแจ้งหนี้ได้",
    });
  }
}

async function getPaymentReport(req, res) {
  try {
    const dormId = getDormId(req);
    const month = getMonth(req);
    const buildingId = req.query?.buildingId || null;
    const status = req.query?.status || null;

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    if (!month) {
      return sendBadRequest(res, "month ต้องอยู่ในรูปแบบ YYYY-MM");
    }

    const data = await dashboardService.getPaymentReport({
      dormId,
      month,
      buildingId,
      status,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getPaymentReport error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงรายงานการชำระเงินได้",
    });
  }
}

async function getArrearsReport(req, res) {
  try {
    const dormId = getDormId(req);
    const month = getMonth(req);
    const buildingId = req.query?.buildingId || null;

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    if (!month) {
      return sendBadRequest(res, "month ต้องอยู่ในรูปแบบ YYYY-MM");
    }

    const data = await dashboardService.getArrearsReport({
      dormId,
      month,
      buildingId,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getArrearsReport error:", error);
    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงรายงานค้างชำระได้",
    });
  }
}

async function getMonthlyRevenueSummaryReport(req, res) {
  try {
    const dormId = getDormId(req);
    const months = getPositiveInt(req.query?.months, 6, { min: 1, max: 24 });

    if (!dormId) {
      return sendBadRequest(res, "ไม่พบ dormId ใน token หรือ query");
    }

    const data = await dashboardService.getMonthlyRevenueSummaryReport({
      dormId,
      months,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getMonthlyRevenueSummaryReport error:", error);

    return res.status(500).json({
      ok: false,
      message: "ไม่สามารถดึงรายงานสรุปรายรับประจำเดือนได้",
      detail: error?.message || String(error),
    });
  }
}

module.exports = {
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
};