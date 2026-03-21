const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

const { pool } = require("./config/db");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const myDormRoutes = require("./routes/myDorm.routes");
const tenantRoutes = require("./routes/tenant.routes");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// เปิดไฟล์อัปโหลด
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/", (req, res) => {
  res.json({ message: "Roomie API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API ทำงานปกติ" });
});

// routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/my-dorm", myDormRoutes);
app.use("/api/tenants", tenantRoutes);

app.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Database connected successfully");
    console.log(`Server running at http://localhost:${PORT}`);
  } catch (error) {
    console.error("Database connection failed:", error);
  }
});