const express = require("express");
const router = express.Router();

const {
  getTenantRepairFormOptions,
  createRepairRequest,
  getMyRepairRequests,
  getMyRepairRequestDetail,
  cancelMyRepairRequest,
  getOwnerRepairRequests,
  getOwnerRepairRequestDetail,
  updateRepairRequestStatus,
} = require("../controllers/repair.controller");
const { verifyToken } = require("../middleware/auth.middleware");

router.use(verifyToken);

// ฝั่งผู้เช่า
router.get("/tenant/form-options", getTenantRepairFormOptions);
router.post("/tenant", createRepairRequest);
router.get("/tenant/my", getMyRepairRequests);
router.get("/tenant/my/:repairRequestId", getMyRepairRequestDetail);
router.patch("/tenant/my/:repairRequestId/cancel", cancelMyRepairRequest);

// ฝั่งเจ้าของหอ
router.get("/owner", getOwnerRepairRequests);
router.get("/owner/:repairRequestId", getOwnerRepairRequestDetail);
router.patch("/owner/:repairRequestId/status", updateRepairRequestStatus);

module.exports = router;