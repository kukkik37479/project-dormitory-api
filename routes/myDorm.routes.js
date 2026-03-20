const express = require("express");
const { verifyToken } = require("../middleware/auth.middleware");
const {
  getMyDormProfile,
  updateMyDormProfile,
} = require("../controllers/myDorm.controller");

const router = express.Router();

router.get("/profile", verifyToken, getMyDormProfile);
router.put("/profile", verifyToken, updateMyDormProfile);

module.exports = router;