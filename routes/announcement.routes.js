const express = require("express");
const router = express.Router();

const {
  getAnnouncements,
  postMarkAnnouncementsSeen,
  postAnnouncement,
  patchAnnouncement,
  removeAnnouncement,
  getVacancyAnnouncements,
  postVacancyAnnouncement,
  removeVacancyAnnouncement,
} = require("../controllers/announcement.controller");

const { verifyToken } = require("../middleware/auth.middleware");

router.get("/", verifyToken, getAnnouncements);
router.post("/mark-seen", verifyToken, postMarkAnnouncementsSeen);
router.post("/", verifyToken, postAnnouncement);
router.patch("/:announcementId", verifyToken, patchAnnouncement);
router.delete("/:announcementId", verifyToken, removeAnnouncement);

router.get("/vacancy", verifyToken, getVacancyAnnouncements);
router.post("/vacancy", verifyToken, postVacancyAnnouncement);
router.delete(
  "/vacancy/:vacancyAnnouncementId",
  verifyToken,
  removeVacancyAnnouncement
);

module.exports = router;