const express = require("express");
const router = express.Router();

const {
  getPublicHome,
  getPublicDormDetail,
  getPublicRoomDetail,
} = require("../controllers/public.controller");

router.get("/home", getPublicHome);
router.get("/dorms/:identifier", getPublicDormDetail);
router.get("/rooms/:roomId", getPublicRoomDetail);

module.exports = router;