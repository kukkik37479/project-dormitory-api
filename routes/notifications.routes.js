const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");
const { getNotificationSummary } = require("../controllers/notifications.controller");

router.get("/summary", verifyToken, getNotificationSummary);

module.exports = router;