const express = require("express");
const router = express.Router();

const {
  getAnnouncements,
  postAnnouncement,
  patchAnnouncement,
  removeAnnouncement,
} = require("../controllers/announcement.controller");

const { verifyToken } = require("../middleware/auth.middleware");

router.get("/", verifyToken, getAnnouncements);
router.post("/", verifyToken, postAnnouncement);
router.patch("/:announcementId", verifyToken, patchAnnouncement);
router.delete("/:announcementId", verifyToken, removeAnnouncement);

module.exports = router;