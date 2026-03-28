const {
  getAnnouncementsByUser,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getVacancyAnnouncementsByOwner,
  createVacancyAnnouncement,
  archiveVacancyAnnouncement,
} = require("../services/announcement.service");

function getUserFromRequest(req) {
  const user = req.user || {};

  return {
    id: user.id || user.userId || user.user_id || user.sub || null,
    role: user.role || null,
    dormId: user.dormId || user.dorm_id || user.login_dorm_id || null,
  };
}

async function getAnnouncements(req, res) {
  try {
    const { id, role, dormId: dormIdFromToken } = getUserFromRequest(req);
    const dormId = req.query.dormId || dormIdFromToken;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const announcements = await getAnnouncementsByUser(id, role, dormId);

    return res.status(200).json({
      message: "Announcements fetched successfully",
      data: announcements,
    });
  } catch (error) {
    console.error("getAnnouncements error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to fetch announcements",
    });
  }
}

async function postAnnouncement(req, res) {
  try {
    const { id, role, dormId: dormIdFromToken } = getUserFromRequest(req);
    const {
      dorm_id,
      title,
      content,
      publish_date,
      is_pinned,
      status,
    } = req.body;

    const dormId = dorm_id || dormIdFromToken;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const announcement = await createAnnouncement({
      userId: id,
      role,
      dormId,
      title,
      content,
      publishDate: publish_date,
      isPinned: is_pinned,
      status,
    });

    return res.status(201).json({
      message: "Announcement created successfully",
      data: announcement,
    });
  } catch (error) {
    console.error("postAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to create announcement",
    });
  }
}

async function patchAnnouncement(req, res) {
  try {
    const { id, role, dormId: dormIdFromToken } = getUserFromRequest(req);
    const { announcementId } = req.params;
    const {
      dorm_id,
      title,
      content,
      publish_date,
      is_pinned,
      status,
    } = req.body;

    const dormId = dorm_id || dormIdFromToken;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const announcement = await updateAnnouncement({
      announcementId,
      userId: id,
      role,
      dormId,
      title,
      content,
      publishDate: publish_date,
      isPinned: is_pinned,
      status,
    });

    return res.status(200).json({
      message: "Announcement updated successfully",
      data: announcement,
    });
  } catch (error) {
    console.error("patchAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to update announcement",
    });
  }
}

async function removeAnnouncement(req, res) {
  try {
    const { id, role, dormId: dormIdFromToken } = getUserFromRequest(req);
    const { announcementId } = req.params;
    const dormId = req.query.dormId || dormIdFromToken;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await deleteAnnouncement({
      announcementId,
      userId: id,
      role,
      dormId,
    });

    return res.status(200).json({
      message: "Announcement deleted successfully",
      data: result,
    });
  } catch (error) {
    console.error("removeAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to delete announcement",
    });
  }
}

async function getVacancyAnnouncements(req, res) {
  try {
    const { id, role, dormId: dormIdFromToken } = getUserFromRequest(req);
    const dormId = req.query.dormId || dormIdFromToken;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (role !== "owner") {
      return res.status(403).json({
        message: "Only owner can access vacancy announcements",
      });
    }

    const announcements = await getVacancyAnnouncementsByOwner(id, dormId);

    return res.status(200).json({
      message: "Vacancy announcements fetched successfully",
      data: announcements,
    });
  } catch (error) {
    console.error("getVacancyAnnouncements error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to fetch vacancy announcements",
    });
  }
}

async function postVacancyAnnouncement(req, res) {
  try {
    const { id, role, dormId: dormIdFromToken } = getUserFromRequest(req);
    const { dorm_id, room_id, note, status } = req.body;

    const dormId = dorm_id || dormIdFromToken;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (role !== "owner") {
      return res.status(403).json({
        message: "Only owner can create vacancy announcements",
      });
    }

    const announcement = await createVacancyAnnouncement({
      userId: id,
      dormId,
      roomId: room_id,
      note,
      status,
    });

    return res.status(201).json({
      message: "Vacancy announcement created successfully",
      data: announcement,
    });
  } catch (error) {
    console.error("postVacancyAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to create vacancy announcement",
    });
  }
}

async function removeVacancyAnnouncement(req, res) {
  try {
    const { id, role, dormId: dormIdFromToken } = getUserFromRequest(req);
    const { vacancyAnnouncementId } = req.params;
    const dormId = req.query.dormId || dormIdFromToken;

    if (!id || !role) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (role !== "owner") {
      return res.status(403).json({
        message: "Only owner can archive vacancy announcements",
      });
    }

    const result = await archiveVacancyAnnouncement({
      vacancyAnnouncementId,
      userId: id,
      dormId,
    });

    return res.status(200).json({
      message: "Vacancy announcement archived successfully",
      data: result,
    });
  } catch (error) {
    console.error("removeVacancyAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to archive vacancy announcement",
    });
  }
}

module.exports = {
  getAnnouncements,
  postAnnouncement,
  patchAnnouncement,
  removeAnnouncement,
  getVacancyAnnouncements,
  postVacancyAnnouncement,
  removeVacancyAnnouncement,
};