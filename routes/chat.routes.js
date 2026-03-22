const express = require("express");
const router = express.Router();

const {
  getConversations,
  getConversationMessages,
  postMessage,
  markAsRead,
} = require("../controllers/chat.controller");

const { verifyToken } = require("../middleware/auth.middleware");

router.get("/conversations", verifyToken, getConversations);
router.get(
  "/conversations/:conversationId/messages",
  verifyToken,
  getConversationMessages
);
router.post(
  "/conversations/:conversationId/messages",
  verifyToken,
  postMessage
);
router.patch(
  "/conversations/:conversationId/read",
  verifyToken,
  markAsRead
);

module.exports = router;