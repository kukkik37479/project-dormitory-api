const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middleware/auth.middleware");
const {
  getOwnerReviewStats,
  getOwnerReviews,
  createReviewReply,
  updateReviewReply,
  deleteReviewReply,
  updateReviewStatus,
  deleteReview,
} = require("../controllers/review.controller");

router.get("/owner/stats", verifyToken, getOwnerReviewStats);
router.get("/owner", verifyToken, getOwnerReviews);

router.post("/:reviewId/reply", verifyToken, createReviewReply);
router.patch("/:reviewId/reply", verifyToken, updateReviewReply);
router.delete("/:reviewId/reply", verifyToken, deleteReviewReply);

router.patch("/:reviewId/status", verifyToken, updateReviewStatus);
router.delete("/:reviewId", verifyToken, deleteReview);

module.exports = router;