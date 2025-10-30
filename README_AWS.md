# AWS CloudWatch Metrics API Documentation

This document provides comprehensive documentation for all AWS CloudWatch metrics endpoints available in the VisHeart Cardiac Segmentation Server.

## Table of Contents

1. [Overview](#overview)
2. [Authentication & Prerequisites](#authentication--prerequisites)
3. [Response Format](#response-format)
4. [EC2 Metrics API](#ec2-metrics-api)
5. [ECR Metrics API](#ecr-metrics-api)
6. [S3 Metrics API](#s3-metrics-api)
7. [ALB Metrics API](#alb-metrics-api)
8. [Auto Scaling Group (ASG) Metrics API](#auto-scaling-group-asg-metrics-api)
9. [Billing & Cost Metrics API](#billing--cost-metrics-api)
10. [Environment Configuration](#environment-configuration)
11. [Error Handling](#error-handling)

---

## Overview

The AWS Metrics API provides real-time monitoring and historical data for various AWS services used by the VisHeart application. All metrics are fetched from AWS CloudWatch and Cost Explorer services.

**Base URL**: Your server base URL (e.g., `http://localhost:3000` or your production domain)

**AWS SDK**: Uses `@aws-sdk/client-cloudwatch` and `@aws-sdk/client-cost-explorer`

---

## Authentication & Prerequisites

### AWS Credentials
All AWS metric endpoints require proper AWS credentials to be configured:

```bash
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=ap-southeast-1  # or your preferred region
```

### IAM Permissions Required
Your AWS IAM user/role must have the following permissions:
- `cloudwatch:GetMetricStatistics` - For CloudWatch metrics
- `ce:GetCostAndUsage` - For billing/cost metrics
- `s3:ListBuckets` - For S3 bucket listing
- `ec2:Describe*` - For EC2 metadata (optional, if not using env vars)

---

## Response Format

### Standard Metric Response
All metric endpoints return data in the following format:

```json
{
  "timestamps": [
    "2025-10-30T10:00:00.000Z",
    "2025-10-30T10:05:00.000Z",
    "2025-10-30T10:10:00.000Z"
  ],
  "values": [45.2, 52.1, 48.9]
}
```

- **timestamps**: ISO 8601 formatted datetime strings
- **values**: Numeric values corresponding to each timestamp
- Data points are sorted chronologically (oldest to newest)

### Error Response
```json
{
  "error": "Error Type",
  "message": "Detailed error message"
}
```

---

## EC2 Metrics API

Monitor EC2 instance performance metrics.

**Base Path**: `/metrics`

**Time Range**: Last 1 hour
**Period**: 5 minutes
**Instance**: Automatically detected from environment variable or EC2 metadata service

### Endpoints

#### 1. CPU Utilization
```http
GET /metrics/cpu-utilization
```

**Description**: Fetches CPU utilization percentage for the current EC2 instance.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z", "2025-10-30T10:05:00.000Z"],
  "values": [45.2, 52.1]
}
```

**Units**: Percent (0-100)
**Statistic**: Average

---

#### 2. Network In
```http
GET /metrics/network-in
```

**Description**: Fetches the number of bytes received by the EC2 instance.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [1024567.0]
}
```

**Units**: Bytes
**Statistic**: Sum

---

#### 3. Network Out
```http
GET /metrics/network-out
```

**Description**: Fetches the number of bytes sent by the EC2 instance.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [2048934.0]
}
```

**Units**: Bytes
**Statistic**: Sum

---

#### 4. Disk Read
```http
GET /metrics/disk-read
```

**Description**: Fetches the number of bytes read from all disks on the EC2 instance.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [512000.0]
}
```

**Units**: Bytes
**Statistic**: Sum

---

#### 5. Disk Write
```http
GET /metrics/disk-write
```

**Description**: Fetches the number of bytes written to all disks on the EC2 instance.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [1024000.0]
}
```

**Units**: Bytes
**Statistic**: Sum

---

## ECR Metrics API

Monitor Elastic Container Registry (ECR) repository metrics.

**Base Path**: `/ecr`

**Time Range**: Last 7 days
**Period**: 1 day
**Note**: Repository size and image count metrics are not available in CloudWatch and will return empty arrays.

### Endpoints

#### 1. Backend Repository Pull Count (Legacy)
```http
GET /ecr/repository-size
GET /ecr/image-count
```

**Description**: Fetches pull count metrics for the backend ECR repository (legacy endpoints).

**Response Example**:
```json
{
  "timestamps": ["2025-10-29T00:00:00.000Z", "2025-10-30T00:00:00.000Z"],
  "values": [15, 23]
}
```

**Units**: Count
**Statistic**: Sum
**Default Repository**: `cardiac_segmentation_fyp_server_backend`

---

#### 2. Backend Repository Metrics
```http
GET /ecr/backend/repository-size
GET /ecr/backend/image-count
```

**Description**: Fetches pull count metrics for the backend ECR repository.

**Response Example**:
```json
{
  "timestamps": ["2025-10-29T00:00:00.000Z"],
  "values": [23]
}
```

**Units**: Count
**Statistic**: Sum
**Repository**: Configured via `ECR_BACKEND_REPOSITORY_NAME` (default: `cardiac_segmentation_fyp_server_backend`)

---

#### 3. Frontend Repository Metrics
```http
GET /ecr/frontend/repository-size
GET /ecr/frontend/image-count
```

**Description**: Fetches pull count metrics for the frontend ECR repository.

**Response Example**:
```json
{
  "timestamps": ["2025-10-29T00:00:00.000Z"],
  "values": [12]
}
```

**Units**: Count
**Statistic**: Sum
**Repository**: Configured via `ECR_FRONTEND_REPOSITORY_NAME` (default: `cardiac_segmentation_fyp_server_frontend`)

---

## S3 Metrics API

Monitor S3 bucket storage and request metrics.

**Base Path**: `/metrics/s3`

**Time Ranges**: 
- Storage metrics (size, object count): Last 30 days, period 1 day
- Request metrics: Last 7 days, period 1 hour

### Endpoints

#### 1. List All Buckets
```http
GET /metrics/s3/buckets
```

**Description**: Lists all S3 buckets in your AWS account.

**Response Example**:
```json
{
  "buckets": [
    {
      "Name": "my-bucket-name",
      "CreationDate": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

---

#### 2. Bucket Size
```http
GET /metrics/s3/:bucketName/bucket-size
```

**Description**: Fetches the total size of the specified S3 bucket.

**Path Parameters**:
- `bucketName` (required): Name of the S3 bucket

**Response Example**:
```json
{
  "timestamps": ["2025-10-29T00:00:00.000Z", "2025-10-30T00:00:00.000Z"],
  "values": [1024567890.50, 1034567890.25]
}
```

**Units**: Bytes
**Statistic**: Average
**Storage Type**: StandardStorage

---

#### 3. Object Count
```http
GET /metrics/s3/:bucketName/object-count
```

**Description**: Fetches the total number of objects in the specified S3 bucket.

**Path Parameters**:
- `bucketName` (required): Name of the S3 bucket

**Response Example**:
```json
{
  "timestamps": ["2025-10-29T00:00:00.000Z"],
  "values": [1523]
}
```

**Units**: Count
**Statistic**: Average
**Storage Type**: AllStorageTypes

---

#### 4. All Requests
```http
GET /metrics/s3/:bucketName/all-requests
```

**Description**: Fetches the total number of all request types made to the S3 bucket.

**Path Parameters**:
- `bucketName` (required): Name of the S3 bucket

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z", "2025-10-30T11:00:00.000Z"],
  "values": [234, 198]
}
```

**Units**: Count
**Statistic**: Sum

---

#### 5. GET Requests
```http
GET /metrics/s3/:bucketName/get-requests
```

**Description**: Fetches the number of GET requests made to the S3 bucket.

**Path Parameters**:
- `bucketName` (required): Name of the S3 bucket

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [150]
}
```

**Units**: Count
**Statistic**: Sum

---

#### 6. PUT Requests
```http
GET /metrics/s3/:bucketName/put-requests
```

**Description**: Fetches the number of PUT requests made to the S3 bucket.

**Path Parameters**:
- `bucketName` (required): Name of the S3 bucket

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [45]
}
```

**Units**: Count
**Statistic**: Sum

---

#### 7. All Metrics Combined
```http
GET /metrics/s3/:bucketName/all
```

**Description**: Fetches all available S3 metrics for the specified bucket in a single request.

**Path Parameters**:
- `bucketName` (required): Name of the S3 bucket

**Response Example**:
```json
{
  "bucketName": "my-bucket-name",
  "bucketSizeBytes": {
    "timestamps": ["2025-10-29T00:00:00.000Z"],
    "values": [1024567890.50]
  },
  "numberOfObjects": {
    "timestamps": ["2025-10-29T00:00:00.000Z"],
    "values": [1523]
  },
  "allRequests": {
    "timestamps": ["2025-10-30T10:00:00.000Z"],
    "values": [234]
  },
  "getRequests": {
    "timestamps": ["2025-10-30T10:00:00.000Z"],
    "values": [150]
  },
  "putRequests": {
    "timestamps": ["2025-10-30T10:00:00.000Z"],
    "values": [45]
  }
}
```

---

## ALB Metrics API

Monitor Application Load Balancer (ALB) performance and health metrics.

**Base Path**: `/metrics/alb`

**Time Range**: Last 24 hours
**Period**: 5 minutes
**Load Balancer**: Configured via `ALB_NAME` environment variable

### Endpoints

#### 1. Request Count
```http
GET /metrics/alb/request-count
```

**Description**: Fetches the total number of requests handled by the Application Load Balancer.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z", "2025-10-30T10:05:00.000Z"],
  "values": [1234, 1456]
}
```

**Units**: Count
**Statistic**: Sum

---

#### 2. Target Response Time
```http
GET /metrics/alb/target-response-time
```

**Description**: Fetches the average time taken by targets to respond to requests.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [0.125]
}
```

**Units**: Seconds
**Statistic**: Average

---

#### 3. HTTP 4XX Errors (ELB)
```http
GET /metrics/alb/http-4xx-elb
```

**Description**: Fetches the number of HTTP 4xx errors generated by the Application Load Balancer itself (e.g., malformed requests).

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [12]
}
```

**Units**: Count
**Statistic**: Sum

---

#### 4. HTTP 4XX Errors (Target)
```http
GET /metrics/alb/http-4xx-target
```

**Description**: Fetches the number of HTTP 4xx errors returned by the targets behind the ALB.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [23]
}
```

**Units**: Count
**Statistic**: Sum

---

#### 5. Healthy Host Count
```http
GET /metrics/alb/healthy-hosts
```

**Description**: Fetches the number of healthy targets registered to the Application Load Balancer.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [2]
}
```

**Units**: Count
**Statistic**: Average
**Requirement**: Requires `TARGET_GROUP_NAME` environment variable

---

#### 6. Unhealthy Host Count
```http
GET /metrics/alb/unhealthy-hosts
```

**Description**: Fetches the number of unhealthy targets registered to the Application Load Balancer.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [0]
}
```

**Units**: Count
**Statistic**: Average
**Requirement**: Requires `TARGET_GROUP_NAME` environment variable

---

## Auto Scaling Group (ASG) Metrics API

Monitor Auto Scaling Group capacity and instance metrics.

**Base Path**: `/metrics/asg`

**Time Range**: Last 1 hour
**Period**: 5 minutes
**Auto Scaling Group**: Configured via `ASG_NAME` environment variable

### Endpoints

#### 1. Minimum Size
```http
GET /metrics/asg/min-size
```

**Description**: Fetches the minimum size configured for the Auto Scaling Group.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [1]
}
```

**Units**: Count
**Statistic**: Maximum

---

#### 2. Maximum Size
```http
GET /metrics/asg/max-size
```

**Description**: Fetches the maximum size configured for the Auto Scaling Group.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [4]
}
```

**Units**: Count
**Statistic**: Maximum

---

#### 3. Desired Capacity
```http
GET /metrics/asg/desired-capacity
```

**Description**: Fetches the desired capacity (target number of instances) for the Auto Scaling Group.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [2]
}
```

**Units**: Count
**Statistic**: Average

---

#### 4. In-Service Instances
```http
GET /metrics/asg/in-service
```

**Description**: Fetches the number of instances currently in service and running.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [2]
}
```

**Units**: Count
**Statistic**: Average

---

#### 5. Pending Instances
```http
GET /metrics/asg/pending
```

**Description**: Fetches the number of instances that are pending and being launched.

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [0]
}
```

**Units**: Count
**Statistic**: Average

---

#### 6. Total Instances
```http
GET /metrics/asg/total
```

**Description**: Fetches the total number of instances in the Auto Scaling Group (in-service + pending + terminating).

**Response Example**:
```json
{
  "timestamps": ["2025-10-30T10:00:00.000Z"],
  "values": [2]
}
```

**Units**: Count
**Statistic**: Average

---

## Billing & Cost Metrics API

Monitor AWS costs and spending using AWS Cost Explorer.

**Base Path**: `/metrics/billing`

**Time Range**: Current month (from 1st to last day)
**Granularity**: Monthly
**Currency**: USD

### Endpoints

#### 1. Total Costs
```http
GET /metrics/billing/total
```

**Description**: Fetches the total AWS costs for the current month.

**Response Example**:
```json
{
  "success": true,
  "data": [
    {
      "service": "Total",
      "amount": 125.45,
      "unit": "USD"
    }
  ],
  "timestamp": "2025-10-30T10:15:00.000Z"
}
```

**Response Fields**:
- `success`: Boolean indicating if the request was successful
- `data`: Array of cost data objects
- `timestamp`: ISO 8601 timestamp of when the data was retrieved

---

#### 2. Costs by Service
```http
GET /metrics/billing/by-service
```

**Description**: Fetches AWS costs grouped by service for the current month.

**Response Example**:
```json
{
  "success": true,
  "data": [
    {
      "service": "Amazon Elastic Compute Cloud - Compute",
      "amount": 45.30,
      "unit": "USD"
    },
    {
      "service": "Amazon Simple Storage Service",
      "amount": 12.50,
      "unit": "USD"
    },
    {
      "service": "Amazon Elastic Container Registry (ECR)",
      "amount": 5.75,
      "unit": "USD"
    },
    {
      "service": "Amazon Elastic Load Balancing",
      "amount": 18.20,
      "unit": "USD"
    }
  ],
  "timestamp": "2025-10-30T10:15:00.000Z"
}
```

**Response Fields**:
- `success`: Boolean indicating if the request was successful
- `data`: Array of cost data objects, each containing:
  - `service`: Name of the AWS service
  - `amount`: Cost in USD
  - `unit`: Currency unit (typically "USD")
- `timestamp`: ISO 8601 timestamp of when the data was retrieved

---

## Environment Configuration

### Required Environment Variables

```bash
# AWS Credentials
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=ap-southeast-1

# EC2 Metrics (optional - will fetch from metadata service if not provided)
EC2_INSTANCE_ID=i-1234567890abcdef0

# ECR Metrics
ECR_BACKEND_REPOSITORY_NAME=cardiac_segmentation_fyp_server_backend
ECR_FRONTEND_REPOSITORY_NAME=cardiac_segmentation_fyp_server_frontend

# ALB Metrics
ALB_NAME=app/my-load-balancer/1234567890abcdef
TARGET_GROUP_NAME=targetgroup/my-target-group/1234567890abcdef

# ASG Metrics
ASG_NAME=my-auto-scaling-group
```

### Environment Variable Details

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | Yes | - | AWS access key for API authentication |
| `AWS_SECRET_ACCESS_KEY` | Yes | - | AWS secret key for API authentication |
| `AWS_REGION` | No | `us-east-1` | AWS region for CloudWatch queries |
| `EC2_INSTANCE_ID` | No | Auto-detected | EC2 instance ID (fetched from metadata if not set) |
| `ECR_BACKEND_REPOSITORY_NAME` | No | `cardiac_segmentation_fyp_server_backend` | Backend ECR repository name |
| `ECR_FRONTEND_REPOSITORY_NAME` | No | `cardiac_segmentation_fyp_server_frontend` | Frontend ECR repository name |
| `ALB_NAME` | Yes* | - | ALB name in format `app/name/id` (*for ALB metrics) |
| `TARGET_GROUP_NAME` | Yes* | - | Target group name (*for host count metrics) |
| `ASG_NAME` | Yes* | - | Auto Scaling Group name (*for ASG metrics) |

---

## Error Handling

### Common Error Responses

#### 1. Configuration Error
**Status Code**: 400 or 500

```json
{
  "error": "Configuration Error",
  "message": "ALB_NAME environment variable is not configured"
}
```

**Cause**: Required environment variable is missing.

---

#### 2. Authentication Error
**Status Code**: 403

```json
{
  "error": "Authentication Error",
  "message": "Invalid AWS credentials"
}
```

**Cause**: AWS credentials are invalid or expired.

---

#### 3. Access Denied
**Status Code**: 403

```json
{
  "error": "Access Denied",
  "message": "You do not have permission to access ALB CloudWatch metrics"
}
```

**Cause**: IAM user/role lacks necessary permissions for CloudWatch or Cost Explorer.

---

#### 4. Invalid Parameter
**Status Code**: 400

```json
{
  "error": "Invalid Parameter",
  "message": "The ALB name or metric parameters are invalid"
}
```

**Cause**: Provided parameters (e.g., bucket name, ALB name) are invalid or don't exist.

---

#### 5. Internal Server Error
**Status Code**: 500

```json
{
  "error": "Internal Server Error",
  "message": "Failed to retrieve CPU utilization metrics: Network timeout"
}
```

**Cause**: Various issues including network problems, AWS service issues, or CloudWatch API errors.

---

#### 6. Bucket Name Required (S3)
**Status Code**: 400

```json
{
  "error": "Bucket name is required"
}
```

**Cause**: S3 bucket name not provided in the URL path parameter.

---

## Implementation Notes

### CloudWatch Service (`src/services/cloudwatch.ts`)

The CloudWatch service implements:
- Singleton pattern for AWS SDK clients (CloudWatch and Cost Explorer)
- Automatic EC2 instance ID detection via metadata service with fallback to environment variable
- Generic metric fetching functions for each service type
- Error handling with detailed logging via Winston logger
- Configurable time ranges and periods based on metric type

### Metric Characteristics

| Service | Time Range | Period | Update Frequency |
|---------|-----------|--------|------------------|
| EC2 | 1 hour | 5 minutes | Real-time |
| ECR | 7 days | 1 day | Daily |
| S3 (Storage) | 30 days | 1 day | Daily |
| S3 (Requests) | 7 days | 1 hour | Hourly |
| ALB | 24 hours | 5 minutes | Real-time |
| ASG | 1 hour | 5 minutes | Real-time |
| Billing | Current month | Monthly | Daily |

### Data Processing

All metrics undergo the following processing:
1. Timestamps are sorted chronologically (oldest to newest)
2. Values are formatted with appropriate decimal precision
3. Empty datapoints are handled gracefully
4. All timestamps are returned in ISO 8601 UTC format

---

## Usage Examples

### JavaScript/TypeScript (Fetch API)

```typescript
// Fetch CPU utilization metrics
async function getCpuMetrics() {
  try {
    const response = await fetch('http://localhost:3000/metrics/cpu-utilization');
    const data = await response.json();
    
    console.log('CPU Utilization:', data);
    // Plot or display the data
  } catch (error) {
    console.error('Error fetching CPU metrics:', error);
  }
}

// Fetch S3 bucket metrics
async function getS3Metrics(bucketName: string) {
  try {
    const response = await fetch(`http://localhost:3000/metrics/s3/${bucketName}/all`);
    const data = await response.json();
    
    console.log(`S3 Metrics for ${data.bucketName}:`, data);
  } catch (error) {
    console.error('Error fetching S3 metrics:', error);
  }
}

// Fetch current month's AWS costs
async function getBillingInfo() {
  try {
    const response = await fetch('http://localhost:3000/metrics/billing/by-service');
    const result = await response.json();
    
    if (result.success) {
      console.log('Costs by Service:', result.data);
    }
  } catch (error) {
    console.error('Error fetching billing info:', error);
  }
}
```

### cURL Examples

```bash
# Get EC2 CPU utilization
curl http://localhost:3000/metrics/cpu-utilization

# Get S3 bucket list
curl http://localhost:3000/metrics/s3/buckets

# Get S3 metrics for a specific bucket
curl http://localhost:3000/metrics/s3/my-bucket-name/all

# Get ALB request count
curl http://localhost:3000/metrics/alb/request-count

# Get ASG capacity metrics
curl http://localhost:3000/metrics/asg/desired-capacity

# Get current month's billing
curl http://localhost:3000/metrics/billing/total
```

---

## Monitoring Dashboard Integration

These metrics endpoints are designed to be integrated into monitoring dashboards. Recommended visualizations:

### EC2 Metrics
- **Line Chart**: CPU utilization over time
- **Area Chart**: Network In/Out combined view
- **Gauge**: Current CPU percentage

### S3 Metrics
- **Line Chart**: Bucket size growth over time
- **Bar Chart**: Request counts by type
- **Pie Chart**: Storage distribution across buckets

### ALB Metrics
- **Line Chart**: Request count and response time
- **Stacked Area**: 4XX errors (ELB vs Target)
- **Status Indicator**: Healthy vs Unhealthy hosts

### ASG Metrics
- **Line Chart**: Instance counts (min, max, desired, actual)
- **Gauge**: Current capacity vs desired

### Billing Metrics
- **Pie Chart**: Cost distribution by service
- **Bar Chart**: Monthly spend trend
- **Counter**: Total monthly cost

---

## Troubleshooting

### Issue: "Unable to retrieve EC2 instance ID"
**Solution**: Set `EC2_INSTANCE_ID` environment variable or ensure EC2 metadata service is accessible at `http://169.254.169.254/latest/meta-data/instance-id`

### Issue: "ALB_NAME environment variable is not set"
**Solution**: Set the `ALB_NAME` environment variable with your load balancer's full name (format: `app/name/id`)

### Issue: Empty metrics arrays
**Possible Causes**:
1. CloudWatch data not yet available (metrics may have delays)
2. Service not generating any data (e.g., no S3 requests made)
3. Incorrect resource name in environment variables
4. Time range configured outside of data retention period

### Issue: 403 Access Denied
**Solution**: Verify IAM permissions include `cloudwatch:GetMetricStatistics` and service-specific describe permissions

### Issue: ECR metrics show empty arrays for size/count
**Expected Behavior**: CloudWatch doesn't provide `RepositorySizeBytes` or `ImageCount` metrics for ECR. Use ECR API directly for this information.

---

## Additional Resources

- [AWS CloudWatch Documentation](https://docs.aws.amazon.com/cloudwatch/)
- [AWS Cost Explorer API](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-api.html)
- [IAM Policies for CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/permissions-reference-cw.html)

---

## Version History

- **v1.0.0** (2025-10-30): Initial AWS metrics API implementation
  - EC2 metrics (CPU, Network, Disk)
  - ECR pull count metrics
  - S3 storage and request metrics
  - ALB performance and health metrics
  - ASG capacity metrics
  - Billing and cost metrics

---

*Last Updated: October 30, 2025*
