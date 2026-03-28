const express = require("express");
const router = express.Router();

const {
  getRoomsMeta,
  getRooms,
  getVacantRooms,
  createBuilding,
  createRoom,
  updateRoomStatus,
  getRoomDetail,
} = require("../controllers/rooms.controller");

const { verifyToken } = require("../middleware/auth.middleware");

router.use(verifyToken);

router.get("/meta", getRoomsMeta);
router.get("/vacant", getVacantRooms);
router.get("/", getRooms);
router.post("/buildings", createBuilding);
router.post("/", createRoom);
router.patch("/:roomId/status", updateRoomStatus);
router.get("/:roomId", getRoomDetail);

module.exports = router;