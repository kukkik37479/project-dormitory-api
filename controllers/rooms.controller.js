const {
  getRoomMetaByOwnerId,
  listRoomsByOwnerId,
  getVacantRoomsByOwnerId,
  createBuildingByOwnerId,
  createRoomByOwnerId,
  getRoomDetailByOwnerId,
} = require("../services/rooms.service");

function ensureOwner(req, res) {
  if (!req.user || req.user.role !== "owner") {
    res.status(403).json({ message: "Only owner can access rooms API" });
    return false;
  }
  return true;
}

async function getRoomsMeta(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const data = await getRoomMetaByOwnerId(req.user.userId);

    return res.json({
      message: "Rooms meta fetched successfully",
      ...data,
    });
  } catch (error) {
    console.error("getRoomsMeta error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function getRooms(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const rooms = await listRoomsByOwnerId(req.user.userId);

    return res.json({
      message: "Rooms fetched successfully",
      rooms,
    });
  } catch (error) {
    console.error("getRooms error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function getVacantRooms(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const rooms = await getVacantRoomsByOwnerId(req.user.userId);

    return res.json({
      message: "Vacant rooms fetched successfully",
      rooms,
    });
  } catch (error) {
    console.error("getVacantRooms error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function createBuilding(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const building = await createBuildingByOwnerId(req.user.userId, req.body);

    return res.status(201).json({
      message: "Building created successfully",
      building,
    });
  } catch (error) {
    console.error("createBuilding error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function createRoom(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const room = await createRoomByOwnerId(req.user.userId, req.body);

    return res.status(201).json({
      message: "Room created successfully",
      room,
    });
  } catch (error) {
    console.error("createRoom error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function getRoomDetail(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const data = await getRoomDetailByOwnerId(
      req.user.userId,
      req.params.roomId
    );

    return res.json({
      message: "Room detail fetched successfully",
      ...data,
    });
  } catch (error) {
    console.error("getRoomDetail error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

module.exports = {
  getRoomsMeta,
  getRooms,
  getVacantRooms,
  createBuilding,
  createRoom,
  getRoomDetail,
};