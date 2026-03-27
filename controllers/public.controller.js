const {
  getPublicHomeData,
  getPublicDormDetailByIdentifier,
  getPublicRoomDetailById,
} = require("../services/public.service");

// GET /api/public/home
async function getPublicHome(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const dormLimit = req.query.dormLimit;
    const dormOffset = req.query.dormOffset;
    const vacantLimit = req.query.vacantLimit;
    const vacantOffset = req.query.vacantOffset;

    const data = await getPublicHomeData({
      search,
      dormLimit,
      dormOffset,
      vacantLimit,
      vacantOffset,
    });

    return res.status(200).json({
      message: "Public home data fetched successfully",
      ...data,
    });
  } catch (error) {
    console.error("GET PUBLIC HOME ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

// GET /api/public/dorms/:identifier
async function getPublicDormDetail(req, res) {
  try {
    const { identifier } = req.params;

    if (!identifier) {
      return res.status(400).json({
        message: "identifier is required",
      });
    }

    const dorm = await getPublicDormDetailByIdentifier(identifier);

    if (!dorm) {
      return res.status(404).json({
        message: "Dorm not found",
      });
    }

    return res.status(200).json({
      message: "Public dorm detail fetched successfully",
      dorm,
    });
  } catch (error) {
    console.error("GET PUBLIC DORM DETAIL ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

// GET /api/public/rooms/:roomId
async function getPublicRoomDetail(req, res) {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({
        message: "roomId is required",
      });
    }

    const room = await getPublicRoomDetailById(roomId);

    if (!room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    return res.status(200).json({
      message: "Public room detail fetched successfully",
      room,
    });
  } catch (error) {
    console.error("GET PUBLIC ROOM DETAIL ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

module.exports = {
  getPublicHome,
  getPublicDormDetail,
  getPublicRoomDetail,
};