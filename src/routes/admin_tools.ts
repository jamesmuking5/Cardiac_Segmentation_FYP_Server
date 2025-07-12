// File: src/routes/admin_tools.ts
/**
 * This file defines administrative tools and routes for managing the application.
 */

import { Request, Response, Router } from "express";
import { readGPUHost, updateGPUHost, IGPUHost } from "../services/database";
import { isAuthAndAdmin } from "../services/passportjs";
import logger from "../services/logger";
import LogError from "../utils/error_logger";

const router = Router();
const serviceLocation = "API (Admin Tools)";

// Get current GPU configuration
router.get("/gpu-config", isAuthAndAdmin, async (req: Request, res: Response) => {
  try {
    const result = await readGPUHost();
    if (result.success && result.gpuHost) {
      // Remove sensitive data before sending
      const safeConfig = {
        host: result.gpuHost.host,
        port: result.gpuHost.port,
        isHTTPS: result.gpuHost.isHTTPS,
        description: result.gpuHost.description,
        jwtRefreshInterval: result.gpuHost.jwtRefreshInterval,
        jwtLifetimeSeconds: result.gpuHost.jwtLifetimeSeconds,
        createdAt: result.gpuHost.createdAt,
        updatedAt: result.gpuHost.updatedAt,
        setBy: result.gpuHost.setBy
      };

      return res.status(200).json({
        success: true,
        gpuHost: safeConfig
      });
    } else {
      return res.status(404).json({
        success: false,
        message: result.message || "No GPU configuration found"
      });
    }
  } catch (error) {
    LogError(error as Error, serviceLocation, "Error reading GPU configuration");
    return res.status(500).json({
      success: false,
      message: "An error occurred while reading GPU configuration"
    });
  }
});

// Update GPU configuration
router.put("/gpu-config", isAuthAndAdmin, async (req: Request, res: Response) => {
  try {
    const { host, port, isHTTPS, description, jwtRefreshInterval, jwtLifetimeSeconds } = req.body;
    const adminUserId = (req.user as any)?._id;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: "Admin user ID not found"
      });
    }

    // Input validation
    if (host && (typeof host !== 'string' || host.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: "Invalid host format"
      });
    }

    if (port !== undefined && (typeof port !== 'number' || port < 1 || port > 65535)) {
      return res.status(400).json({
        success: false,
        message: "Port must be between 1 and 65535"
      });
    }

    if (jwtRefreshInterval !== undefined && (typeof jwtRefreshInterval !== 'number' || jwtRefreshInterval < 60000)) {
      return res.status(400).json({
        success: false,
        message: "JWT refresh interval must be at least 60 seconds (60000ms)"
      });
    }

    if (jwtLifetimeSeconds !== undefined && (typeof jwtLifetimeSeconds !== 'number' || jwtLifetimeSeconds < 60)) {
      return res.status(400).json({
        success: false,
        message: "JWT lifetime must be at least 60 seconds"
      });
    }

    const updates: Partial<IGPUHost> = {
      setBy: adminUserId
    };

    if (host) updates.host = host.trim();
    if (port !== undefined) updates.port = port;
    if (isHTTPS !== undefined) updates.isHTTPS = isHTTPS;
    if (description !== undefined) updates.description = description;
    if (jwtRefreshInterval !== undefined) updates.jwtRefreshInterval = jwtRefreshInterval;
    if (jwtLifetimeSeconds !== undefined) updates.jwtLifetimeSeconds = jwtLifetimeSeconds;

    const result = await updateGPUHost(updates);

    if (result.success && result.gpuHost) {
      logger.info(`Admin ${adminUserId} updated GPU configuration`);

      // Remove sensitive data before sending
      const safeConfig = {
        host: result.gpuHost.host,
        port: result.gpuHost.port,
        isHTTPS: result.gpuHost.isHTTPS,
        description: result.gpuHost.description,
        jwtRefreshInterval: result.gpuHost.jwtRefreshInterval,
        jwtLifetimeSeconds: result.gpuHost.jwtLifetimeSeconds,
        updatedAt: result.gpuHost.updatedAt,
        setBy: result.gpuHost.setBy
      };

      return res.status(200).json({
        success: true,
        message: "GPU configuration updated successfully",
        gpuHost: safeConfig
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to update GPU configuration"
      });
    }
  } catch (error) {
    LogError(error as Error, serviceLocation, "Error updating GPU configuration");
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating GPU configuration"
    });
  }
});

export default router;
// ...existing code...