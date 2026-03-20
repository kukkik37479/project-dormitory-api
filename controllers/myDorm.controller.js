const {
  getMyDormProfileByOwnerId,
  updateMyDormProfileByOwnerId,
} = require("../services/myDorm.service");

// GET /api/my-dorm/profile
async function getMyDormProfile(req, res) {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    if (role !== "owner") {
      return res.status(403).json({
        message: "Only owner can access dorm profile",
      });
    }

    const dorm = await getMyDormProfileByOwnerId(userId);

    if (!dorm) {
      return res.status(404).json({
        message: "Dorm not found",
      });
    }

    return res.status(200).json({
      message: "Dorm profile fetched successfully",
      dorm,
    });
  } catch (error) {
    console.error("GET MY DORM PROFILE ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

// PUT /api/my-dorm/profile
async function updateMyDormProfile(req, res) {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    if (role !== "owner") {
      return res.status(403).json({
        message: "Only owner can update dorm profile",
      });
    }

    const { name, name_en, full_address } = req.body;

    if (!name || !name_en || !full_address) {
      return res.status(400).json({
        message: "name, name_en and full_address are required",
      });
    }

    const dorm = await updateMyDormProfileByOwnerId(userId, req.body);

    if (!dorm) {
      return res.status(404).json({
        message: "Dorm not found",
      });
    }

    return res.status(200).json({
      message: "Dorm profile updated successfully",
      dorm,
    });
  } catch (error) {
    console.error("UPDATE MY DORM PROFILE ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

module.exports = {
  getMyDormProfile,
  updateMyDormProfile,
};