# VisHeart Cardiac Segmentation Server - AI Coding Instructions

## Architecture Overview
This is a **medical imaging backend** that processes cardiac NIfTI/DICOM files through AI segmentation. The system coordinates between:
- **Node.js/Express API** (this server) - handles file uploads, user management, project lifecycle
- **GPU Server** (`./visheart-inference-gpu`) - FastAPI + YOLO + MedSAM for cardiac segmentation
- **MongoDB** - stores projects, users, segmentation masks, and job queues
- **Redis** - manages sessions and caching
- **AWS S3** - stores original files and processed outputs
- **Python scripts** - handles medical image format conversions (NIfTI ↔ JPEG)

## Core Data Flow
1. User uploads NIfTI/DICOM → stored in S3, metadata extracted via Python
2. Segmentation request → queued as Job, sent to GPU server with presigned S3 URLs
3. GPU server (YOLO + MedSAM) → returns RLE-encoded masks via webhook callbacks
4. Results stored in MongoDB, converted to NIfTI for export

## Essential Patterns

### Authentication & Authorization
- **Session-based auth** via `express-session` + Redis (not JWT)
- **Role hierarchy**: Guest < User < Admin (see `UserRole` enum)
- **Middleware stack**: `isAuth` → `isAuthAndNotGuest` → `isAuthAndAdmin`
- **GPU authentication**: Self-generated JWT system via `gpu_auth_client.ts` + `injectGpuAuthToken` middleware

### Database Patterns
- **Service layer**: All DB operations go through `src/services/database.ts`
- **Type safety**: Strict interfaces in `src/types/database_types.ts`
- **CRUD pattern**: Functions return `{ success: boolean, message?: string, data?: T }`
- **Document structure**: Projects contain embedded segmentation frames/slices

### File Processing
- **Upload flow**: `project_routes.ts` → `uploadmiddleware.ts` → `project_handler.ts` → S3
- **Python integration**: Execute via `child_process.exec()` for medical image operations
- **Temp directories**: `temp_upload/`, `temp_jpeg/`, `temp_exports/` (auto-cleaned)

### Error Handling
- **Centralized logging**: Winston logger in `src/services/logger.ts`
- **Error utility**: `LogError()` function for consistent error tracking
- **Response pattern**: Always return `{ success: boolean, message: string }` structure

## Development Commands
```bash
npm run dev          # Development with nodemon + ts-node
npm run build        # TypeScript compilation to dist/
npm run test         # Jest tests (currently mostly commented out)
npm start           # Production (runs compiled JS)
```

## Environment Dependencies
**Critical env vars** (check `.env` file):
- `MONGODB_URI`, `REDIS_URL` - Database connections
- `AWS_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - S3 storage
- `GPU_SERVER_URL`, `GPU_SERVER_PORT` - Cloud inference server
- `SESSION_SECRET` - Session encryption
- `ADMIN_PASS` - Default admin password

## Route Structure
- `/auth/*` - User registration, login, role management
- `/projects/*` - File upload, project lifecycle, metadata
- `/segmentation/*` - AI inference, manual segmentation, results export
- `/admin/*` - Admin tools, system monitoring
- `/webhook/*` - GPU server callbacks for async processing

## Common Gotchas
- **File extensions**: Handle both `.nii` and `.nii.gz` formats
- **Medical data types**: Use proper TypeScript enums for `FileDataType`, `ComponentBoundingBoxesClass`
- **Async operations**: Always use proper error handling with try/catch and `LogError()`
- **Middleware order**: GPU auth middleware must come after user auth middleware
- **Segmentation merging**: Use `mergeFramesData()` function for combining manual edits
