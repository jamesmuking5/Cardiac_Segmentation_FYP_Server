// src/routes/s3_metrics.ts
import express, { Request, Response } from "express";
import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import logger from "../services/logger";

const router = express.Router();

const REGION = process.env.AWS_REGION || "ap-southeast-1";
const cloudwatchClient = new CloudWatchClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

// Helper to fetch CloudWatch metrics for S3
async function getS3Metric(bucketName: string, metricName: string, storageType?: string) {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // last 24 hours

  const params: any = {
    Namespace: "AWS/S3",
    MetricName: metricName,
    Dimensions: [
      { Name: "BucketName", Value: bucketName },
      { Name: "StorageType", Value: storageType || "StandardStorage" },
    ],
    StartTime: startTime,
    EndTime: endTime,
    Period: 3600, // 1-hour intervals
    Statistics: ["Average"],
  };

  const data = await cloudwatchClient.send(new GetMetricStatisticsCommand(params));
  return data.Datapoints && data.Datapoints.length > 0
    ? data.Datapoints[data.Datapoints.length - 1].Average
    : 0;
}

// Route: GET /metrics/s3
router.get("/", async (_req: Request, res: Response) => {
  try {
    const buckets = await s3Client.send(new ListBucketsCommand({}));
    res.json({ buckets: buckets.Buckets });
  } catch (error) {
    logger.error("Error listing S3 buckets:", error);
    res.status(500).json({ message: "Failed to list S3 buckets", error });
  }
});

// Route: GET /metrics/s3/:bucketName
router.get("/:bucketName", async (req: Request, res: Response) => {
  const { bucketName } = req.params;
  try {
    const [sizeBytes, objectCount, allRequests, getRequests, putRequests] = await Promise.all([
      getS3Metric(bucketName, "BucketSizeBytes", "StandardStorage"),
      getS3Metric(bucketName, "NumberOfObjects", "AllStorageTypes"),
      getS3Metric(bucketName, "AllRequests"),
      getS3Metric(bucketName, "GetRequests"),
      getS3Metric(bucketName, "PutRequests"),
    ]);

    res.json({
      bucketName,
      metrics: {
        BucketSizeBytes: sizeBytes,
        NumberOfObjects: objectCount,
        AllRequests: allRequests,
        GetRequests: getRequests,
        PutRequests: putRequests,
      },
    });
  } catch (error) {
    logger.error(`Error fetching S3 metrics for ${bucketName}:`, error);
    res.status(500).json({ message: "Failed to fetch S3 metrics", error });
  }
});

export default router;