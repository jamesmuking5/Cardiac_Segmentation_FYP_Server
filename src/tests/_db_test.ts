// File: src/tests/_db_test.ts
// Description: This script is a manual test for the database functions in the application. It connects to the database, creates a user, creates a project, updates the project, and deletes the project. It also verifies each step by reading the user and project data from the database and logging the results.
// Run command: npx ts-node src/tests/_db_test.ts
import mongoose from 'mongoose';
import {
    connectToDatabase,
    createUser,
    readUser,
    deleteUser,
    createProject,
    readProject,
    updateProject,
    deleteProject,
    UserRole,
    createProjectSegmentationMask,
    readProjectSegmentationMask,
    updateProjectSegmentationMask,
} from '../services/database';
import {
    FileType,
    FileDataType,
    IProject,
    IProjectSegmentationMask,
    ComponentBoundingBoxesClass,
} from '../types/database_types';
import logger from '../services/logger';


async function createTestUser() {
    const userData = {
        username: 'dbtest',
        password: 'password123',
        email: 'dbtest@example.com',
        phone: '1112223333',
        role: UserRole.Admin
    };

    const result = await createUser(
        userData.username,
        userData.password,
        userData.email,
        userData.phone,
        userData.role
    );

    if (result.success) {
        logger.info("Manual Test: User created:", result);
        return true;
    }

    logger.error("Manual Test: User creation failed:", result.message);
    return false;
}

async function getTestUserId(username: string) {
    const result = await readUser(undefined, username);

    if (!result.success || !result.users || result.users.length === 0) {
        logger.error("Manual Test: User read failed or user not found:", result.message || "User not found");
        return null;
    }

    return result.users[0]._id;
}

async function verifyUserCreation(username: string) {
    const result = await readUser(undefined, username);

    if (!result.success || !result.users || result.users.length === 0) {
        logger.error("Manual Test: User read failed or user not found:",
            result.message || "User not found");
        return null;
    }

    const user = result.users[0];

    logger.info(`User id ${user._id}`);
    logger.info(`User email ${user.email}`);
    logger.info(`User phone ${user.phone}`);
    logger.info(`User role ${user.role}`);
    logger.info(`User created at ${user.createdAt}`);
    logger.info(`User updated at ${user.updatedAt}`);

    return user;
}

function generateProjectData(userId: string): IProject {
    const filehash = '2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3';
    const filename = `${String(userId)}_${filehash}`;
    const basePath = `s3://devel-visheart-s3-bucket/temp/${userId}/${filename}`;

    return {
        userid: String(userId),
        name: 'Test Project',
        originalfilename: 'turtles',
        description: 'A test project description, I love turtles, I love turtles',
        isSaved: false,
        filename,
        filetype: FileType.NIFTI_GZ,
        filesize: 33400000, // 33.4 MB
        filehash,
        basepath: basePath,
        originalfilepath: `${basePath}/${filename}.nii.gz`,
        extractedfolderpath: `${basePath}/extracted`,
        status: { upload: true, extract: true },
        datatype: FileDataType.FLOAT32,
        dimensions: { width: 216, height: 256, slices: 10, frames: 30 },
        voxelsize: { x: 1, y: 1, z: 1, t: 1 },
    };
}

async function createTestProject(projectData: IProject) {
    const result = await createProject(
        projectData.userid,
        projectData.name,
        projectData.originalfilename,
        projectData.isSaved,
        projectData.filename,
        projectData.filetype,
        projectData.filesize,
        projectData.filehash,
        projectData.basepath,
        projectData.originalfilepath,
        projectData.extractedfolderpath,
        projectData.status,
        projectData.datatype,
        projectData.dimensions,
        projectData.voxelsize,
        projectData.description,
    );

    if (result.success) {
        logger.info("Manual Test: Project created:", result);
        return true;
    }

    logger.error("Manual Test: Project creation failed:", result.message);
    return false;
}

function generateSegmentationMaskData(projectId: string): IProjectSegmentationMask {
    return {
        projectid: projectId,
        name: 'Test Segmentation Mask',
        description: 'A test segmentation mask',
        isSaved: true,
        isMedSAMOutput: true,
        frames: [
            {
                frameIndex: 0,
                frameInferred: true,
                slices: [
                    {
                        sliceindex: 0,
                        slicepath: `s3://devel-visheart-s3-bucket/temp/${projectId}/slice_0.png`,
                        componentboundingboxes: [
                            {
                                class: ComponentBoundingBoxesClass.LVC,
                                x_min: 10,
                                y_min: 10,
                                x_max: 100,
                                y_max: 100
                            },
                            {
                                class: ComponentBoundingBoxesClass.MYO,
                                x_min: 5,
                                y_min: 5,
                                x_max: 120,
                                y_max: 120
                            }
                        ],
                        segmentationmaskslocation: [
                            {
                                path: `s3://devel-visheart-s3-bucket/temp/${projectId}/mask_0_lvc.png`,
                                isRLE: false
                            },
                            {
                                path: `s3://devel-visheart-s3-bucket/temp/${projectId}/mask_0_myo.png`,
                                isRLE: false
                            }
                        ]
                    },
                    {
                        sliceindex: 1,
                        slicepath: `s3://devel-visheart-s3-bucket/temp/${projectId}/slice_1.png`,
                        segmentationmaskslocation: [
                            {
                                path: `s3://devel-visheart-s3-bucket/temp/${projectId}/mask_1_lvc.png`,
                                isRLE: false
                            }
                        ]
                    },
                    {
                        sliceindex: 2,
                        slicepath: `s3://devel-visheart-s3-bucket/temp/${projectId}/slice_2.png`,
                        segmentationmaskslocation: [
                            {
                                path: `s3://devel-visheart-s3-bucket/temp/${projectId}/mask_2_lvc.png`,
                                isRLE: false
                            }
                        ]
                    }
                ]
            }
        ]
    };
}



async function readSegmentationMask(projectId: string) {
    const result = await readProjectSegmentationMask(projectId);

    if (result.success && result.projectsegmentationmasks && result.projectsegmentationmasks.length > 0) {
        logger.info("Manual Test: Segmentation mask read successfully:", result);
        return result.projectsegmentationmasks[0];
    }

    logger.error("Manual Test: Segmentation mask read failed:", result.message || "Segmentation mask not found");
    return null;
}

async function updateTestSegmentationMask(maskId: string) {
    try {
        // Create update data with various changes
        const updateData = {
            name: 'Updated Segmentation Mask',
            description: 'This mask has been updated via testing',
            isSaved: true,
            frames: [
                {
                    frameIndex: 0,
                    frameInferred: true,
                    slices: [
                        {
                            sliceindex: 0,
                            slicepath: `s3://devel-visheart-s3-bucket/temp/updated_slice_0.png`,
                            componentboundingboxes: [
                                {
                                    class: ComponentBoundingBoxesClass.LVC,
                                    x_min: 15,
                                    y_min: 15,
                                    x_max: 105,
                                    y_max: 105
                                }
                            ],
                            segmentationmaskslocation: [
                                {
                                    path: `s3://devel-visheart-s3-bucket/temp/updated_mask_0.png`,
                                    isRLE: true
                                }
                            ]
                        },
                        {
                            sliceindex: 1,
                            slicepath: `s3://devel-visheart-s3-bucket/temp/updated_slice_1.png`,
                            segmentationmaskslocation: [
                                {
                                    path: `s3://devel-visheart-s3-bucket/temp/updated_mask_1.png`,
                                    isRLE: true
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        // Call the update function
        const result = await updateProjectSegmentationMask(maskId, updateData);

        if (!result.success) {
            logger.error("Manual Test: Segmentation mask update failed:", result.message);
            return false;
        }

        logger.info("Manual Test: Segmentation mask updated successfully:", result);

        // Verify the changes
        const updatedMask = result.projectsegmentationmask;
        if (updatedMask) {
            logger.info("Manual Test: Updated segmentation mask details:");
            logger.info(`- Name: ${updatedMask.name}`);
            logger.info(`- Description: ${updatedMask.description}`);
            logger.info(`- isSaved: ${updatedMask.isSaved}`);
            logger.info(`- isMedSAMOutput: ${updatedMask.isMedSAMOutput}`);
            logger.info(`- Number of frames: ${updatedMask.frames.length}`);
            logger.info(`- First frame slices: ${updatedMask.frames[0].slices.length}`);
            logger.info(`- First slice path: ${updatedMask.frames[0].slices[0].slicepath}`);

            // Log bounding box details if available
            if (updatedMask.frames[0].slices[0].componentboundingboxes?.length) {
                const box = updatedMask.frames[0].slices[0].componentboundingboxes[0];
                logger.info(`- First bounding box: (${box.x_min},${box.y_min}) to (${box.x_max},${box.y_max})`);
            }
        }

        return true;
    } catch (error) {
        logger.error("Manual Test: An error occurred while updating the segmentation mask:", error);
        return false;
    }
}

async function createTestSegmentationMask(projectId: string) {
    const maskData = generateSegmentationMaskData(projectId);

    const result = await createProjectSegmentationMask(maskData);

    if (result.success) {
        logger.info("Manual Test: Segmentation mask created:", result);
        return result.projectsegmentationmask;
    }

    logger.error("Manual Test: Segmentation mask creation failed:", result.message);
    return null;
}

async function verifyProjectCreation(userId: string, projectName: string) {
    const result = await readProject(undefined, userId, projectName);

    if (!result.success || !result.projects || result.projects.length === 0) {
        logger.error("Manual Test: Project read failed:", result.message || "Project not found");
        return null;
    }

    const project = result.projects[0];

    logger.info(`Project id ${project._id}`);
    logger.info(`Project name ${project.name}`);
    logger.info(`Project description ${project.description}`);
    logger.info(`Project created at ${project.createdAt}`);
    logger.info(`Project updated at ${project.updatedAt}`);

    // Create a paragraph describing the project
    const projectDescription = `Project ID: ${project._id}, Name: ${project.name}, ` +
        `Description: ${project.description}, Created At: ${project.createdAt}, ` +
        `Updated At: ${project.updatedAt} with dimensions ` +
        `${project.dimensions.width}x${project.dimensions.height}x` +
        `${project.dimensions.slices}x${project.dimensions.frames} and ` +
        `possible undefined voxels with size ${project.voxelsize?.x}x` +
        `${project.voxelsize?.y}x${project.voxelsize?.z}x${project.voxelsize?.t}.`;

    logger.info(`Manual Test: Project description: ${projectDescription}`);

    return project;
}

// Fix the updateTestProject function to use projectId instead of userId
async function updateTestProject(projectId: string) {
    try {
        const updateData = {
            name: 'Updated Project Name',
            description: 'Updated project description',
            isSaved: true,
            originalfilename: 'updated_turtles',
            filename: `updated_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3`,
            filehash: 'updated_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3',
            dimensions: {
                width: 300,
                height: 400,
                slices: 15,
                frames: 40
            },
            voxelsize: {
                x: 0.5,
                y: 0.5,
                z: 1.5,
                t: 2.5
            },
            status: {
                upload: true,
                extract: true
            },
            datatype: FileDataType.UINT16
        };

        // Use projectId for update
        const result = await updateProject(projectId, updateData);

        if (!result.success) {
            logger.error("Manual Test: Project update failed:", result.message);
            return false;
        }

        logger.info("Manual Test: Project updated successfully:", result);

        // Use projectId for verification query
        const verifyResult = await readProject(projectId);

        if (!verifyResult.success || !verifyResult.projects || !verifyResult.projects[0]) {
            logger.error("Manual Test: Failed to retrieve updated project");
            return false;
        }

        const updated = verifyResult.projects[0];
        logger.info("Manual Test: Updated project details:");
        logger.info(`- Name: ${updated.name}`);
        logger.info(`- Description: ${updated.description}`);
        logger.info(`- isSaved: ${updated.isSaved}`);
        logger.info(`- Dimensions: ${updated.dimensions.width}x${updated.dimensions.height}x${updated.dimensions.slices}x${updated.dimensions.frames}`);
        logger.info(`- Voxel size: ${updated.voxelsize?.x}x${updated.voxelsize?.y}x${updated.voxelsize?.z}x${updated.voxelsize?.t}`);

        return true;
    } catch (error) {
        logger.error("Manual Test: An error occurred while updating the project:", error);
        return false;
    }
}

async function deleteTestProject(projectId: string) {
    try {
        // Delete the project
        const result = await deleteProject(projectId);

        if (!result.success) {
            logger.error("Manual Test: Project deletion failed:", result.message);
            return false;
        }

        logger.info("Manual Test: Project deleted successfully:", result);

        // Verify deletion by attempting to retrieve it again
        const verifyResult = await readProject(projectId);

        if (verifyResult.success && verifyResult.projects && verifyResult.projects.length > 0) {
            logger.error("Manual Test: Project still exists after deletion");
            return false;
        }

        logger.info("Manual Test: Verified project no longer exists");
        return true;
    } catch (error) {
        logger.error("Manual Test: An error occurred while deleting the project:", error);
        return false;
    }
}

// Modify runManualTests to include segmentation mask testing
async function runManualTests(): Promise<void> {
    try {
        await connectToDatabase();

        // Step 1: Create and verify user
        if (await createTestUser()) {
            const user = await verifyUserCreation('dbtest');

            if (user) {
                // Step 2: Create and verify project
                const projectData = generateProjectData(String(user._id));

                if (await createTestProject(projectData)) {
                    const project = await verifyProjectCreation(projectData.userid, projectData.name);

                    if (project) {
                        // New Step: Create a segmentation mask for the project
                        const segMask = await createTestSegmentationMask(String(project._id));
                        if (segMask) {
                            logger.info(`Manual Test: Segmentation mask created with ID: ${segMask._id}`);
                            logger.info(`Manual Test: Segmentation mask has ${segMask.frames.length} frames`);
                            logger.info(`Manual Test: First frame has ${segMask.frames[0].slices.length} slices`);

                            // Read segmentation mask
                            const readSegMask = await readSegmentationMask(String(project._id));
                            if (readSegMask) {
                                logger.info(`Manual Test: Segmentation mask read successfully with ID: ${readSegMask._id}`);

                                // Update the segmentation mask
                                await updateTestSegmentationMask(String(readSegMask._id));
                            }
                        }

                        // Step 3: Update and verify project
                        await updateTestProject(String(project._id));

                        // Step 4: Delete project (should cascade delete the segmentation masks) 
                        // Commented out to test cascade delete
                        // await deleteTestProject(String(project._id));
                    }
                }
            }
        }

        // Delete the test user
        const userId = await getTestUserId('dbtest');
        if (userId) {
            await deleteUser(userId);
        } else {
            logger.error("Manual Test: Could not find user to delete");
        }
    } catch (error) {
        logger.error("Manual Test: An unexpected error occurred:", error);
    } finally {
        await mongoose.disconnect();
        logger.info("Manual Test: Database disconnected.");
        process.exit(0);
    }
}


// Run the tests
runManualTests();