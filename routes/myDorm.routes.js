const express = require("express");
const { verifyToken } = require("../middleware/auth.middleware");
const {
  getMyDormProfile,
  updateMyDormProfile,
  createAmenity,
  deleteAmenity,
} = require("../controllers/myDorm.controller");

const router = express.Router();

router.get("/profile", verifyToken, getMyDormProfile);
router.put("/profile", verifyToken, updateMyDormProfile);
router.post("/amenities", verifyToken, createAmenity);
router.delete("/amenities/:code", verifyToken, deleteAmenity);

module.exports = router;