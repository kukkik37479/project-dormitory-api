const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");
const contractUpload = require("../middleware/upload.middleware");
const {
  getTenants,
  getTenantFormOptions,
  createTenant,
  getMyRoom,
  getMyDormReview,
  upsertMyDormReview,
} = require("../controllers/tenant.controller");

router.get("/", verifyToken, getTenants);
router.get("/form-options", verifyToken, getTenantFormOptions);

router.post(
  "/",
  verifyToken,
  contractUpload.single("contract_file"),
  createTenant
);

router.get("/my-room", verifyToken, getMyRoom);

router.get("/dorms/:dormId/my-review", verifyToken, getMyDormReview);
router.post("/dorms/:dormId/my-review", verifyToken, upsertMyDormReview);

module.exports = router;