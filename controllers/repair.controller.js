const {
  getUserIdFromToken,
  getDormIdFromToken,
  getTenantRepairFormOptionsByTenantId,
  createRepairRequestByTenantId,
  listMyRepairRequestsByTenantId,
  listRepairRequestsByOwnerId,
  getRepairRequestDetailForTenantById,
  getRepairRequestDetailForOwnerById,
  updateRepairRequestStatusByOwnerId,
  cancelRepairRequestByTenantId,
} = require("../services/repair.service");

function handleError(res, error, fallbackMessage, logPrefix) {
  const status = error.status || 500;

  if (status >= 500) {
    console.error(`${logPrefix}:`, error);
    return res.status(status).json({
      message: fallbackMessage,
      error: error.message,
    });
  }

  return res.status(status).json({
    message: error.message || fallbackMessage,
  });
}

const getTenantRepairFormOptions = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);
    const dormId = getDormIdFromToken(req.user);

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    const data = await getTenantRepairFormOptionsByTenantId(userId, dormId);

    return res.status(200).json({
      message: "ดึงข้อมูลฟอร์มแจ้งซ่อมสำเร็จ",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการดึงข้อมูลฟอร์มแจ้งซ่อม",
      "GET TENANT REPAIR FORM OPTIONS ERROR"
    );
  }
};

const createRepairRequest = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);
    const dormId = getDormIdFromToken(req.user);

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    const data = await createRepairRequestByTenantId(userId, dormId, req.body || {});

    return res.status(201).json({
      message: "สร้างรายการแจ้งซ่อมสำเร็จ",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการสร้างรายการแจ้งซ่อม",
      "CREATE REPAIR REQUEST ERROR"
    );
  }
};

const getMyRepairRequests = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);
    const dormId = getDormIdFromToken(req.user);

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    const result = await listMyRepairRequestsByTenantId(userId, dormId, req.query || {});

    return res.status(200).json({
      message: "ดึงรายการแจ้งซ่อมของผู้เช่าสำเร็จ",
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการดึงรายการแจ้งซ่อมของผู้เช่า",
      "GET MY REPAIR REQUESTS ERROR"
    );
  }
};

const getMyRepairRequestDetail = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);
    const dormId = getDormIdFromToken(req.user);
    const repairRequestId = String(req.params.repairRequestId || "").trim();

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    if (!repairRequestId) {
      return res.status(400).json({
        message: "กรุณาระบุรหัสรายการแจ้งซ่อม",
      });
    }

    const data = await getRepairRequestDetailForTenantById(
      userId,
      dormId,
      repairRequestId
    );

    return res.status(200).json({
      message: "ดึงรายละเอียดรายการแจ้งซ่อมสำเร็จ",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการดึงรายละเอียดรายการแจ้งซ่อม",
      "GET MY REPAIR REQUEST DETAIL ERROR"
    );
  }
};

const cancelMyRepairRequest = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);
    const dormId = getDormIdFromToken(req.user);
    const repairRequestId = String(req.params.repairRequestId || "").trim();

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    if (!repairRequestId) {
      return res.status(400).json({
        message: "กรุณาระบุรหัสรายการแจ้งซ่อม",
      });
    }

    const data = await cancelRepairRequestByTenantId(
      userId,
      dormId,
      repairRequestId,
      req.body || {}
    );

    return res.status(200).json({
      message: "ยกเลิกรายการแจ้งซ่อมสำเร็จ",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการยกเลิกรายการแจ้งซ่อม",
      "CANCEL MY REPAIR REQUEST ERROR"
    );
  }
};

const getOwnerRepairRequests = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    const result = await listRepairRequestsByOwnerId(userId, req.query || {});

    return res.status(200).json({
      message: "ดึงรายการแจ้งซ่อมของเจ้าของหอสำเร็จ",
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการดึงรายการแจ้งซ่อมของเจ้าของหอ",
      "GET OWNER REPAIR REQUESTS ERROR"
    );
  }
};

const getOwnerRepairRequestDetail = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);
    const repairRequestId = String(req.params.repairRequestId || "").trim();

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    if (!repairRequestId) {
      return res.status(400).json({
        message: "กรุณาระบุรหัสรายการแจ้งซ่อม",
      });
    }

    const data = await getRepairRequestDetailForOwnerById(userId, repairRequestId);

    return res.status(200).json({
      message: "ดึงรายละเอียดรายการแจ้งซ่อมสำหรับเจ้าของหอสำเร็จ",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการดึงรายละเอียดรายการแจ้งซ่อมสำหรับเจ้าของหอ",
      "GET OWNER REPAIR REQUEST DETAIL ERROR"
    );
  }
};

const updateRepairRequestStatus = async (req, res) => {
  try {
    const userId = getUserIdFromToken(req.user);
    const repairRequestId = String(req.params.repairRequestId || "").trim();

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบข้อมูลผู้ใช้งานใน token",
      });
    }

    if (!repairRequestId) {
      return res.status(400).json({
        message: "กรุณาระบุรหัสรายการแจ้งซ่อม",
      });
    }

    const data = await updateRepairRequestStatusByOwnerId(
      userId,
      repairRequestId,
      req.body || {}
    );

    return res.status(200).json({
      message: "อัปเดตสถานะรายการแจ้งซ่อมสำเร็จ",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "เกิดข้อผิดพลาดในการอัปเดตสถานะรายการแจ้งซ่อม",
      "UPDATE REPAIR REQUEST STATUS ERROR"
    );
  }
};

module.exports = {
  getTenantRepairFormOptions,
  createRepairRequest,
  getMyRepairRequests,
  getMyRepairRequestDetail,
  cancelMyRepairRequest,
  getOwnerRepairRequests,
  getOwnerRepairRequestDetail,
  updateRepairRequestStatus,
};