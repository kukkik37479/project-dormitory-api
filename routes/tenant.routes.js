const express = require("express");
const router = express.Router();

const {
  getTenants,
  getTenantFormOptions,
  createTenant,
  getMyRoom,
} = require("../controllers/tenant.controller");

const { verifyToken } = require("../middleware/auth.middleware");
const contractUpload = require("../middleware/upload.middleware");

router.get("/", verifyToken, getTenants);
router.get("/form-options", verifyToken, getTenantFormOptions);
router.post("/", verifyToken, contractUpload.single("contract_file"), createTenant);
router.get("/my-room", verifyToken, getMyRoom);

module.exports = router;