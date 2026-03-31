const { buildNotificationSummary } = require("../services/notifications.service");

async function getNotificationSummary(req, res) {
  try {
    const data = await buildNotificationSummary(req.user || {});

    return res.status(200).json({
      message: "ดึงข้อมูลแจ้งเตือนสำเร็จ",
      data,
    });
  } catch (error) {
    console.error("GET NOTIFICATION SUMMARY ERROR:", error);

    return res.status(error.status || 500).json({
      message: error.message || "เกิดข้อผิดพลาดในการดึงข้อมูลแจ้งเตือน",
    });
  }
}

module.exports = {
  getNotificationSummary,
};