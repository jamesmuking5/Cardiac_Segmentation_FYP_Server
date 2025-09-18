import express from 'express';
import AWS from 'aws-sdk';

const router = express.Router();
const s3 = new AWS.S3();

router.get('/s3-usage', async (req, res) => {
  try {
    const buckets = await s3.listBuckets().promise();
    // For each bucket, get file count and size (simplified example)
    const usage = await Promise.all(
      buckets.Buckets?.map(async (bucket) => {
        const objects = await s3.listObjectsV2({ Bucket: bucket.Name! }).promise();
        const totalSize = objects.Contents?.reduce((sum, obj) => sum + (obj.Size || 0), 0) || 0;
        return {
          bucket: bucket.Name,
          fileCount: objects.KeyCount,
          totalSize,
        };
      }) || []
    );
    res.json({ usage });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

export default router;