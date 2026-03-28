const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

const { pool } = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const myDormRoutes = require("./routes/myDorm.routes");
const tenantRoutes = require("./routes/tenant.routes");
const roomsRoutes = require("./routes/rooms.routes");
const contractRoutes = require("./routes/contract.routes");
const chatRoutes = require("./routes/chat.routes");
const announcementRoutes = require("./routes/announcement.routes");
const furnitureRoutes = require("./routes/furniture.routes");
const invoiceRoutes = require("./routes/invoices.routes");
const bankAccountRoutes = require("./routes/bankAccounts.routes");
const paymentRoutes = require("./routes/payments.routes");
const repairRoutes = require("./routes/repair.routes");
const publicRoutes = require("./routes/public.routes");
const reviewRoutes = require("./routes/review.routes");
const dashboardRoutes = require("./routes/dashboard.routes");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/", (req, res) => {
  res.json({ message: "Roomie API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API ทำงานปกติ" });
});

app.use("/api/public", publicRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/my-dorm", myDormRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/rooms", roomsRoutes);
app.use("/api/contracts", contractRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/furniture", furnitureRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/bank-accounts", bankAccountRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/repair-requests", repairRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Database connected successfully");
    console.log(`Server running at http://localhost:${PORT}`);
  } catch (error) {
    console.error("Database connection failed:", error);
  }
});