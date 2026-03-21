const express = require("express");
const router = express.Router();

const {
  getTenants,
  getTenantFormOptions,
  createTenant,
} = require("../controllers/tenant.controller");

const { verifyToken } = require("../middleware/auth.middleware");

router.get("/", verifyToken, getTenants);
router.get("/form-options", verifyToken, getTenantFormOptions);
router.post("/", verifyToken, createTenant);

module.exports = router;