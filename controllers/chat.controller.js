const {
  getConversationsByUser,
  getMessages,
  sendMessage,
  markConversationAsRead,
} = require("../services/chat.service");

function getUserFromRequest(req) {
  const user = req.user || {};

  return {
    id: user.id || user.userId || user.user_id || user.sub || null,
    role: user.role || null,
  };
}

async function getConversations(req, res) {
  try {
    console.log("CHAT req.user =", req.user);
    const { id, role } = getUserFromRequest(req);

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (!["owner", "tenant"].includes(role)) {
      return res.status(403).json({
        message: "Only owner or tenant can access chat",
      });
    }

    const conversations = await getConversationsByUser(id, role);

    return res.status(200).json({
      message: "Conversations fetched successfully",
      data: conversations,
    });
  } catch (error) {
    console.error("getConversations error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to fetch conversations",
    });
  }
}

async function getConversationMessages(req, res) {
  try {
    const { id, role } = getUserFromRequest(req);
    const { conversationId } = req.params;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (!conversationId) {
      return res.status(400).json({
        message: "conversationId is required",
      });
    }

    const messages = await getMessages(conversationId, id, role);

    return res.status(200).json({
      message: "Messages fetched successfully",
      data: messages,
    });
  } catch (error) {
    console.error("getConversationMessages error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to fetch messages",
    });
  }
}

async function postMessage(req, res) {
  try {
    const { id, role } = getUserFromRequest(req);
    const { conversationId } = req.params;
    const { message_text } = req.body;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (!conversationId) {
      return res.status(400).json({
        message: "conversationId is required",
      });
    }

    const message = await sendMessage(conversationId, id, role, message_text);

    return res.status(201).json({
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    console.error("postMessage error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to send message",
    });
  }
}

async function markAsRead(req, res) {
  try {
    const { id, role } = getUserFromRequest(req);
    const { conversationId } = req.params;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (!conversationId) {
      return res.status(400).json({
        message: "conversationId is required",
      });
    }

    const result = await markConversationAsRead(conversationId, id, role);

    return res.status(200).json({
      message: "Conversation marked as read",
      data: result,
    });
  } catch (error) {
    console.error("markAsRead error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to mark as read",
    });
  }
}

module.exports = {
  getConversations,
  getConversationMessages,
  postMessage,
  markAsRead,
};