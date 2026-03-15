const express = require("express");
const { verifyToken } = require("../middleware/auth.middleware");
const {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
} = require("../controllers/user.controller");

const router = express.Router();

router.get("/me", verifyToken, getMyProfile);
router.put("/me", verifyToken, updateMyProfile);
router.put("/me/password", verifyToken, changeMyPassword);

module.exports = router;