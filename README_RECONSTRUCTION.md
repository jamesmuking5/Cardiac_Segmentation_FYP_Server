# 4D Cardiac Reconstruction Pipeline API Documentation

## Overview

The 4D Cardiac Reconstruction Pipeline provides advanced cardiac mesh reconstruction capabilities using AI-powered SDF (Signed Distance Field) models. This pipeline transforms segmentation masks from cardiac imaging into detailed 3D mesh representations that can be visualized across all cardiac frames.

## Architecture

The reconstruction pipeline follows a distributed microservices architecture:

1. **Backend Server** (Node.js/Express) - Handles authentication, project management, and orchestrates reconstruction workflows
2. **GPU Inference Server** (FastAPI) - Processes 4D reconstruction using deep learning models 
3. **Storage Layer** (AWS S3) - Manages input segmentation data and output mesh files
4. **Database** (MongoDB) - Tracks reconstruction jobs, metadata, and user permissions

## Data Flow

```
[Client Request] → [Authentication] → [Segmentation Validation] → [GPU Processing] → [Mesh Generation] → [Storage & Database]
```

1. Client initiates reconstruction request with project ID and parameters
2. Server validates user permissions and AI segmentation availability
3. Segmentation data is packaged and sent to GPU server
4. GPU processes 4D cardiac reconstruction using SDF models
5. Resulting OBJ mesh files are returned via webhook callbacks
6. Server packages meshes into TAR archives and stores in S3
7. Reconstruction metadata is saved to database with download URLs

---

## API Endpoints

### Base Path: `/reconstruction`

All reconstruction endpoints require authentication via session cookies. GPU server communication is handled automatically by the backend.

---

## 1. Start 4D Reconstruction

**Endpoint**: `POST /reconstruction/start-reconstruction/:projectId`

**Description**: Initiates 4D cardiac reconstruction processing for a project with completed AI segmentation masks.

**Authentication**: Required (User or Admin role)

**URL Parameters**:
- `projectId` (string, required): MongoDB project ID to reconstruct

**Request Body**: `application/json`
```json
{
  "reconstructionName": "string",
  "reconstructionDescription": "string", 
  "parameters": {
    "num_iterations": "number",
    "resolution": "number", 
    "process_all_frames": "boolean",
    "debug_save": "boolean",
    "debug_dir": "string"
  },
  "ed_frame": "number"
}
```

### Request Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `reconstructionName` | string | ❌ | `"4D Reconstruction - {ISO timestamp}"` | Name for the reconstruction job |
| `reconstructionDescription` | string | ❌ | `"4D cardiac reconstruction using SDF model"` | Description of the reconstruction |
| `ed_frame` | number | ✅ | `1` | End-diastolic frame number (1-based indexing) |
| `parameters.num_iterations` | number | ❌ | `50` | SDF optimization iterations (range: 1-200) |
| `parameters.resolution` | number | ❌ | `128` | Mesh resolution (range: 32-256) |
| `parameters.process_all_frames` | boolean | ❌ | `true` | Enable 4D processing across all cardiac frames |
| `parameters.debug_save` | boolean | ❌ | `false` | Save debug outputs to persistent location |
| `parameters.debug_dir` | string | ❌ | `"/tmp/4d_reconstruction_debug"` | Debug directory path for intermediate files |

**Prerequisites**:
- Project must exist and belong to the authenticated user
- Project must have completed AI segmentation masks (`isMedSAMOutput: true`)
- Valid `ed_frame` parameter within project's frame range

**Success Response** (HTTP 200):
```json
{
  "message": "4D reconstruction job accepted. UUID: {job-uuid}",
  "uuid": "string - Unique job identifier for tracking"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid `ed_frame` parameter or missing required fields
- **403 Forbidden**: User lacks access to the specified project  
- **404 Not Found**: Project does not exist
- **500 Internal Server Error**: GPU server communication failure or segmentation validation error

**Example Request**:
```bash
curl -X POST https://api.visheart.art/reconstruction/start-reconstruction/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=your-session-cookie" \
  -d '{
    "reconstructionName": "Patient A - ED Analysis",
    "reconstructionDescription": "4D reconstruction for end-diastolic analysis",
    "parameters": {
      "num_iterations": 75,
      "resolution": 256,
      "process_all_frames": true
    },
    "ed_frame": 12
  }'
```

---

## 2. Get Reconstruction Results

**Endpoint**: `GET /reconstruction/reconstruction-results/:projectId`

**Description**: Retrieves all 4D reconstruction results for a specific project, including presigned download URLs for mesh files.

**Authentication**: Required (Any authenticated user)

**URL Parameters**:
- `projectId` (string, required): MongoDB project ID

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "reconstructions": [
    {
      "reconstructionId": "string - MongoDB reconstruction document ID",
      "name": "string - User-defined reconstruction name", 
      "description": "string - Reconstruction description",
      "isSaved": "boolean - Whether reconstruction is marked as saved",
      "isAIGenerated": "boolean - Whether reconstruction was AI-generated", 
      "meshFormat": "string - Mesh file format (e.g., 'TAR', 'OBJ')",
      "meshFileSize": "number - File size in bytes (from reconstructedMesh)",
      "downloadUrl": "string|null - Presigned S3 URL for mesh download (1 hour expiry, null if no mesh)",
      "metadata": {
        "edFrameIndex": "number - End-diastolic frame used (1-based from ed_frame)",
        "reconstructionTime": "number - Processing time in seconds", 
        "numIterations": "number - SDF optimization iterations used",
        "resolution": "number - Mesh resolution",
        "filename": "string - Generated mesh filename", 
        "filesize": "number - File size in bytes (root level)",
        "filehash": "string - SHA256 hash for integrity verification"
      },
      "createdAt": "string (ISO 8601) - Creation timestamp",
      "updatedAt": "string (ISO 8601) - Last modification timestamp"
    }
  ]
}
```

**No Results Response** (HTTP 200):
```json
{
  "message": "No reconstruction results found for this project.",
  "success": false,
  "reconstructions": []
}
```

**Error Responses**:
- **400 Bad Request**: Missing or invalid project ID
- **404 Not Found**: Project does not exist
- **500 Internal Server Error**: Database or S3 access error

**Example Request**:
```bash
curl -X GET https://api.visheart.art/reconstruction/reconstruction-results/507f1f77bcf86cd799439011 \
  -H "Cookie: connect.sid=your-session-cookie"
```

---

## 3. Check User Reconstruction Jobs

**Endpoint**: `GET /reconstruction/user-check-jobs`

**Description**: Retrieves all reconstruction jobs for the authenticated user, including job status and queue position.

**Authentication**: Required (Any authenticated user)

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "activeJobCount": "number - Count of pending/in-progress jobs",
  "totalJobs": "number - Total jobs returned (limited to 20 recent)",
  "jobs": [
    {
      "jobId": "string - Job UUID",
      "projectId": "string - Associated project ID",
      "status": "string - Job status (PENDING, IN_PROGRESS, COMPLETED, FAILED)",
      "name": "string - Job name",
      "description": "string - Job description",
      "queuePosition": "number|null - Queue position for pending jobs (1-based)"
    }
  ]
}
```

**Job Status Values**:
- `PENDING`: Job submitted and waiting for GPU processing
- `IN_PROGRESS`: Currently being processed by GPU server
- `COMPLETED`: Processing finished successfully
- `FAILED`: Processing failed due to error

**Error Response** (HTTP 500):
```json
{
  "success": false,
  "message": "An error occurred while fetching reconstruction jobs"
}
```

**Example Request**:
```bash
curl -X GET https://api.visheart.art/reconstruction/user-check-jobs \
  -H "Cookie: connect.sid=your-session-cookie"
```

---

## GPU Webhook Callback (Internal)

**Endpoint**: `POST /webhook/gpu-reconstruction-callback`

**Description**: Internal webhook endpoint for receiving reconstruction results from the GPU server. This endpoint is not intended for direct client use.

**Authentication**: GPU server authentication (automatic)

**Request Format**: `multipart/form-data`
- OBJ mesh files for each cardiac frame
- JSON metadata with reconstruction parameters and results

**Processing Flow**:
1. Validates incoming OBJ mesh files
2. Creates TAR archive containing all frame meshes  
3. Uploads TAR to S3 with project-based organization
4. Creates reconstruction database record with metadata
5. Updates job status to COMPLETED

---

## Error Handling

### Common Error Scenarios

**Authentication Errors**:
```json
{
  "message": "Authentication required"
}
```

**Insufficient Permissions**:
```json
{
  "message": "Access denied to this project"
}
```

**Missing AI Segmentation**:
```json
{
  "message": "4D reconstruction requires completed segmentation masks. Please complete segmentation before starting reconstruction."
}
```

**Invalid Frame Parameter**:
```json
{
  "message": "Invalid end-diastole frame number: 25. Must be a positive integer >= 1."
}
```

**GPU Server Communication Failure**:
```json
{
  "message": "Failed to start 4D reconstruction: Error communicating with Cloud GPU"
}
```

---

## Prerequisites & Dependencies

### Project Requirements
- **Completed Project Upload**: NIfTI/DICOM files successfully uploaded and processed
- **AI Segmentation**: Project must have AI-generated segmentation masks (`isMedSAMOutput: true`)
- **Frame Validation**: `ed_frame` parameter must be within project's actual frame count

### System Dependencies
- **GPU Server**: Active connection to inference server with SDF models
- **S3 Storage**: Configured AWS bucket for mesh file storage
- **Database**: MongoDB connection for job tracking and metadata

### Authentication Requirements
- **User Session**: Valid session cookie from `/auth/login`
- **Role Permissions**: User or Admin role (Guest users blocked)
- **Project Access**: User must own or have access to the target project

---

## Performance & Limitations

### Processing Times
- **Typical reconstruction**: 3-10 minutes for standard cardiac datasets
- **High-resolution (256+)**: 10-20 minutes depending on frame count
- **Queue wait time**: Variable based on GPU server load

### File Size Limits
- **Input segmentation**: Generated automatically from existing project data
- **Output meshes (Single frame)**: Typically 50-100MB TAR archives per reconstruction
- **Output meshes (Multiple frames)**: Typically 150-200MB TAR archives for ~30 cardiac frames
- **S3 storage**: No explicit limits, managed by AWS billing

### Rate Limiting
- **Concurrent jobs**: Limited by GPU server capacity
- **User limits**: No explicit per-user limits currently enforced
- **Queue management**: FIFO processing with status tracking

### Best Practices
1. **Frame Selection**: Choose end-diastolic frames carefully for optimal results
2. **Parameter Tuning**: Start with default parameters before optimizing
3. **Status Monitoring**: Use `/user-check-jobs` endpoint to track progress
4. **Error Handling**: Implement retry logic for GPU server communication failures
5. **Resource Management**: Allow adequate processing time before retry attempts

---

## Troubleshooting

### Common Issues

**"No AI-generated segmentation masks found"**
- Ensure segmentation has been completed using the AI pipeline
- Manual segmentation masks are not supported for reconstruction
- Verify segmentation masks have `isMedSAMOutput: true`

**"End-diastole frame X exceeds project frame count"**
- Check project metadata for actual frame count
- Use 1-based indexing for `ed_frame` parameter
- Verify frame count via project details endpoint

**"Failed to start 4D reconstruction: GPU server communication error"**  
- Check GPU server status and connectivity
- Verify AWS S3 access and credentials
- Review server logs for detailed error messages

**Reconstruction jobs stuck in PENDING status**
- Monitor GPU server queue via `/user-check-jobs`
- Check server logs for processing bottlenecks
- Contact system administrator if queues are stalled

### Debug Information

Enable debug mode by setting `debug_save: true` in reconstruction parameters:
```json
{
  "parameters": {
    "debug_save": true,
    "debug_dir": "/tmp/debug_reconstruction"
  }
}
```

This saves intermediate processing files for troubleshooting mesh generation issues.

### Support Contacts

For technical issues:
- Review server logs at `/logs/winston_logger/`
- Check GPU server status endpoint
- Contact development team with job UUID and error details